import type { PoolClient } from 'pg'
import { pool } from '@/db/client'
import { config } from '@/config'
import * as repo from './packages.repository'
import { getConfigValue } from '@/lib/system-config'
import { allocateFare, lotExpiry, packagePricing, vehicleGroupOf, type LotRow } from './package-money'
import type { PackageTierView, DriverPackageWallet } from './packages.types'
import { issuePackageInvoiceSafely } from './package-invoice.service'
import { payuConfigured, newTxnId, buildPayuForm, customerFor, PAYU_RETURN_PATH, packageProductInfo, type PayuForm } from '@/lib/payu'

async function writeLedgerEntry(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  args: {
    walletId: number
    driverId: bigint
    entryType: 'topup' | 'ride_consumption' | 'admin_adjustment' | 'expiry'
    amount: number
    direction: 'credit' | 'debit'
    balanceAfter: number
    rideId?: bigint
    referenceId?: string
    note?: string
    createdBy?: bigint
  }
): Promise<void> {
  // entry_type/direction are inlined as literals (not parameterized) — they
  // only ever come from this module's own fixed enum values, never from
  // caller input, matching deductCommission's 'commission_debit'/'debit'
  // pattern in payments.service.ts.
  await client.query(
    `INSERT INTO driver_package_ledger (
       wallet_id, driver_id, entry_type, amount, direction, balance_after,
       ride_id, reference_id, note, created_by
     ) VALUES ($1,$2,'${args.entryType}',$3,'${args.direction}',$4,$5,$6,$7,$8)`,
    [
      args.walletId, args.driverId, args.amount,
      args.balanceAfter, args.rideId ?? null, args.referenceId ?? null,
      args.note ?? null, args.createdBy ?? null,
    ]
  )
}

/** GST added on top of a package price (system_config package_gst_percent, 18 by default). */
export async function getPackageGstPercent(): Promise<number> {
  const v = parseFloat(await getConfigValue('package_gst_percent', '18'))
  return Number.isFinite(v) && v >= 0 ? v : 18
}

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }> }

// Uses up credit lots, soonest expiry first, for an amount that has just come off the wallet balance. Lots already past their expiry but not yet
// swept are still drawn on: a ride that was under way when the plan ran out is paid from it rather than leaving the driver owing.
async function drawLots(client: Q, walletId: number, amount: number): Promise<void> {
  const res = await client.query(
    `SELECT id::text AS id, remaining::float8 AS remaining FROM package_credit_lots
      WHERE wallet_id = $1 AND expired_at IS NULL AND remaining > 0 ORDER BY expires_at ASC, id ASC FOR UPDATE`,
    [walletId]
  )
  const { takes } = allocateFare(res.rows as LotRow[], amount)
  for (const t of takes) {
    await client.query('UPDATE package_credit_lots SET remaining = round(remaining - $2, 2) WHERE id = $1', [t.id, t.take])
  }
}

// Debits the ride's full final fare from the driver's package balance.
// Balance CAN go negative (see migration 078) — that's what blocks the next
// ride offer (see Task 4's broadcast-query branch), it doesn't retroactively
// block the ride that was already assigned.
export async function consumePackageBalance(
  rideId: bigint,
  driverId: bigint,
  fareAmount: number,
  sharedClient?: PoolClient
): Promise<void> {
  if (fareAmount <= 0) return

  // With a sharedClient the caller owns BEGIN/COMMIT/ROLLBACK, so the debit commits or rolls back together
  // with whatever else that transaction settles (payment flip, cash claim) instead of standing alone.
  const client = sharedClient ?? await pool.connect()
  const owns = !sharedClient
  try {
    if (owns) await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_package_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance, is_frozen FROM driver_package_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    )
    // is_frozen is fetched but deliberately NOT enforced here (unlike deductCommission's
    // wallet.is_frozen gate in payments.service.ts). Freeze enforcement for package wallets
    // happens at the broadcast-eligibility query (upcoming task) — blocking settlement of a
    // ride that's already assigned would just create an unpaid ride with no consumption record.
    const wallet = walletRes.rows[0] as { id: number; balance: string; is_frozen: boolean } | undefined
    if (!wallet) {
      if (owns) await client.query('ROLLBACK')
      return
    }

    // A ride is charged once. Every settlement path claims the ride first, but this keeps a retry or a legacy path from ever taking
    // the same fare twice (checked under the wallet row lock, so two concurrent settles cannot both pass).
    const already = await client.query(
      `SELECT 1 FROM driver_package_ledger WHERE wallet_id = $1 AND ride_id = $2 AND entry_type = 'ride_consumption' LIMIT 1`,
      [wallet.id, rideId]
    )
    if ((already.rowCount ?? 0) > 0) {
      if (owns) await client.query('ROLLBACK')
      return
    }

    const currentBalance = parseFloat(wallet.balance)
    const newBalance = Math.round((currentBalance - fareAmount) * 100) / 100

    await client.query(
      `UPDATE driver_package_wallets
       SET balance = $2, lifetime_consumed = lifetime_consumed + $3, updated_at = now()
       WHERE id = $1`,
      [wallet.id, newBalance, fareAmount]
    )

    await drawLots(client, wallet.id, fareAmount)

    await writeLedgerEntry(client, {
      walletId: wallet.id, driverId, entryType: 'ride_consumption',
      amount: fareAmount, direction: 'debit', balanceAfter: newBalance,
      rideId, note: `Ride #${rideId} fare ₹${fareAmount}`,
    })

    if (owns) await client.query('COMMIT')
  } catch (err) {
    if (owns) await client.query('ROLLBACK')
    throw err
  } finally {
    if (owns) client.release()
  }
}

// Credits a package purchase onto the driver's balance (additive top-up), then gives the driver their GST tax invoice for it.
// The invoice comes after the credit has committed and can never undo it; a replayed confirmation re-attempts it, which is how an
// invoice that failed the first time (or waited for Ocar's GSTIN to be set) gets issued.
export async function creditPackageBalance(
  driverId: bigint,
  thresholdValue: number,
  referenceId: string,
  opts: { orderId?: string; validityDays?: number } = {}
): Promise<void> {
  await creditPackageBalanceOnly(driverId, thresholdValue, referenceId, opts)
  if (opts.orderId) await issuePackageInvoiceSafely(opts.orderId)
}

async function creditPackageBalanceOnly(
  driverId: bigint,
  thresholdValue: number,
  referenceId: string,
  opts: { orderId?: string; validityDays?: number } = {}
): Promise<void> {
  if (thresholdValue <= 0) return

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_package_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance FROM driver_package_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    )
    const wallet = walletRes.rows[0] as { id: number; balance: string }

    // Idempotency: a retried/replayed confirmation for the same gateway payment
    // must not credit twice. Checked under the wallet row lock above.
    const dupe = await client.query(
      `SELECT id FROM driver_package_ledger WHERE wallet_id = $1 AND reference_id = $2 LIMIT 1`,
      [wallet.id, referenceId]
    )
    if ((dupe.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK')
      return
    }

    const newBalance = Math.round((parseFloat(wallet.balance) + thresholdValue) * 100) / 100

    await client.query(
      `UPDATE driver_package_wallets
       SET balance = $2, lifetime_topup = lifetime_topup + $3, updated_at = now()
       WHERE id = $1`,
      [wallet.id, newBalance, thresholdValue]
    )

    await writeLedgerEntry(client, {
      walletId: wallet.id, driverId, entryType: 'topup',
      amount: thresholdValue, direction: 'credit', balanceAfter: newBalance,
      referenceId, note: `Package recharge ₹${thresholdValue} threshold`,
    })

    // Each purchase is its own lot with its own expiry. If the driver was overdrawn (a negative balance), that overdraft came out of
    // this credit, so the lot starts with what is actually left of it.
    const validityDays = opts.validityDays ?? 365
    const usable = Math.max(0, Math.min(thresholdValue, newBalance))
    if (usable > 0) {
      await client.query(
        `INSERT INTO package_credit_lots (wallet_id, driver_id, order_id, credited, remaining, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [wallet.id, driverId, opts.orderId ?? null, thresholdValue, usable, lotExpiry(new Date(), validityDays)]
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Admin support tool: signed amount (+credit / -debit), reason required.
// signedAmount === 0 is a no-op (rejected) — the ledger's amount CHECK (> 0)
// constraint would otherwise fail on Math.abs(0).
export async function adjustPackageBalance(
  driverId: bigint,
  signedAmount: number,
  reason: string,
  adminId: bigint
): Promise<void> {
  if (signedAmount === 0) {
    throw new Error('adjustPackageBalance: signedAmount must be non-zero')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_package_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance FROM driver_package_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    )
    const wallet = walletRes.rows[0] as { id: number; balance: string }
    const newBalance = Math.round((parseFloat(wallet.balance) + signedAmount) * 100) / 100

    await client.query(
      `UPDATE driver_package_wallets SET balance = $2, updated_at = now() WHERE id = $1`,
      [wallet.id, newBalance]
    )
    // A debit takes from the lots too (soonest expiry first), so a lot never promises value the balance no longer has.
    // A credit is a goodwill top-up in no lot and does not expire.
    if (signedAmount < 0) await drawLots(client, wallet.id, Math.abs(signedAmount))

    await writeLedgerEntry(client, {
      walletId: wallet.id, driverId, entryType: 'admin_adjustment',
      amount: Math.abs(signedAmount), direction: signedAmount >= 0 ? 'credit' : 'debit',
      balanceAfter: newBalance, note: reason, createdBy: adminId,
    })

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Package purchase — PayU order (or dev-mode direct credit) ──────────────
// Mirrors createRidePaymentOrder's dev-mode bypass in payments.service.ts: no
// PayU keys configured means local/staging environments credit immediately
// instead of opening Checkout, so the purchase flow stays exercisable end to
// end without a gateway.
export async function createPackagePurchaseOrder(
  driverId: bigint,
  tierId: bigint
): Promise<{ payu: PayuForm; amount: number } | { dev: true; credited: number }> {
  const tier = await repo.getTierById(tierId)
  if (!tier || !tier.is_active) {
    throw Object.assign(new Error('Package tier not found or inactive'), { httpStatus: 404 })
  }
  const price = parseFloat(tier.price)
  const threshold = parseFloat(tier.threshold_value)
  // The driver is charged the price plus GST; the ride value they get is the full threshold.
  const pricing = packagePricing(price, await getPackageGstPercent())

  if (!payuConfigured()) {
    await creditPackageBalance(driverId, threshold, `dev_${Date.now()}`, { validityDays: tier.validity_days })
    return { dev: true, credited: threshold }
  }

  const driverRes = await pool.query(`SELECT full_name AS name, email, phone FROM drivers WHERE id = $1`, [driverId])
  const txnId = newTxnId('P', driverId)
  const payu = buildPayuForm({
    txnId, amount: pricing.total,
    productInfo: packageProductInfo(tierId),
    customer: customerFor(driverRes.rows[0] ?? {}, 'driver', driverId),
    returnUrl: `${config.API_BASE_URL}${PAYU_RETURN_PATH}`,
  })
  await repo.createPayuPurchaseOrder({
    driverId, tierId, amount: pricing.total, priceAmount: pricing.price, gstPercent: pricing.gstPercent, gstAmount: pricing.gstAmount,
    validityDays: tier.validity_days, thresholdValue: threshold, txnId,
  })
  return { payu, amount: pricing.total }
}

// ── Plans and wallet as the apps show them ─────────────────────────────────

/** The plans this driver can buy (their vehicle group only), each with the GST added on top and the total charged. */
export async function listTiersForDriver(driverId: bigint): Promise<PackageTierView[]> {
  const group = vehicleGroupOf(await repo.getDriverCategorySlug(driverId))
  const [tiers, gstPercent] = await Promise.all([repo.listActiveTiers(group), getPackageGstPercent()])
  return tiers.map((t) => {
    const p = packagePricing(parseFloat(t.price), gstPercent)
    return { ...t, gst_percent: p.gstPercent, gst_amount: p.gstAmount.toFixed(2), total_amount: p.total.toFixed(2) }
  })
}

export interface PackageWalletView extends Partial<DriverPackageWallet> {
  balance: string
  is_frozen: boolean
  /** The credit the driver still has, by purchase, soonest expiry first. Credit in no lot (never expires) is not listed. */
  lots: Array<{ remaining: string; expires_at: string }>
  next_expiry: string | null
}

export async function getWalletView(driverId: bigint): Promise<PackageWalletView> {
  const wallet = await repo.getPackageWallet(driverId)
  const lots = await repo.listLiveLots(driverId)
  return {
    ...(wallet ?? {}),
    balance: wallet?.balance ?? '0.00',
    is_frozen: wallet?.is_frozen ?? false,
    lots: lots.map((l) => ({ remaining: l.remaining, expires_at: l.expires_at })),
    next_expiry: lots[0]?.expires_at ?? null,
  }
}

// ── Expiry ─────────────────────────────────────────────────────────────────

/**
 * Lapses every credit lot whose 365 days are up: what is left of it comes off the balance as an 'expiry' ledger entry (no refund).
 * Runs on the payments schedule; one wallet per transaction so a failure never holds up the rest. Returns how many lots lapsed.
 */
export async function expireDueLots(batchWallets = 100): Promise<number> {
  const due = await pool.query<{ wallet_id: string }>(
    `SELECT DISTINCT wallet_id::text AS wallet_id FROM package_credit_lots
      WHERE expired_at IS NULL AND remaining > 0 AND expires_at <= now() LIMIT $1`,
    [batchWallets]
  )
  let lapsed = 0
  for (const { wallet_id } of due.rows) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const w = await client.query(`SELECT id, driver_id, balance FROM driver_package_wallets WHERE id = $1 FOR UPDATE`, [wallet_id])
      const wallet = w.rows[0] as { id: number; driver_id: string; balance: string } | undefined
      if (!wallet) { await client.query('ROLLBACK'); continue }
      const lots = await client.query(
        `SELECT id, remaining, created_at FROM package_credit_lots
          WHERE wallet_id = $1 AND expired_at IS NULL AND remaining > 0 AND expires_at <= now() ORDER BY expires_at, id FOR UPDATE`,
        [wallet_id]
      )
      let balance = parseFloat(wallet.balance)
      for (const lot of lots.rows as Array<{ id: string; remaining: string; created_at: Date }>) {
        const amount = parseFloat(lot.remaining)
        balance = Math.round((balance - amount) * 100) / 100
        await client.query(`UPDATE package_credit_lots SET remaining = 0, expired_at = now() WHERE id = $1`, [lot.id])
        await writeLedgerEntry(client, {
          walletId: wallet.id, driverId: BigInt(wallet.driver_id), entryType: 'expiry', amount, direction: 'debit', balanceAfter: balance,
          referenceId: `lot_${lot.id}`, note: `Unused package credit ₹${amount} from ${new Date(lot.created_at).toISOString().slice(0, 10)} expired`,
        })
        lapsed++
      }
      await client.query(`UPDATE driver_package_wallets SET balance = $2, updated_at = now() WHERE id = $1`, [wallet.id, balance])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }
  return lapsed
}
