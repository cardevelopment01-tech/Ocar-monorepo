import { pool } from '@/db/client'

async function writeLedgerEntry(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  args: {
    walletId: number
    driverId: bigint
    entryType: 'topup' | 'ride_consumption' | 'admin_adjustment'
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

// Debits the ride's full final fare from the driver's package balance.
// Balance CAN go negative (see migration 078) — that's what blocks the next
// ride offer (see Task 4's broadcast-query branch), it doesn't retroactively
// block the ride that was already assigned.
export async function consumePackageBalance(
  rideId: bigint,
  driverId: bigint,
  fareAmount: number
): Promise<void> {
  if (fareAmount <= 0) return

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
      `SELECT id, balance, is_frozen FROM driver_package_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    )
    // is_frozen is fetched but deliberately NOT enforced here (unlike deductCommission's
    // wallet.is_frozen gate in payments.service.ts). Freeze enforcement for package wallets
    // happens at the broadcast-eligibility query (upcoming task) — blocking settlement of a
    // ride that's already assigned would just create an unpaid ride with no consumption record.
    const wallet = walletRes.rows[0] as { id: number; balance: string; is_frozen: boolean } | undefined
    if (!wallet) {
      await client.query('ROLLBACK')
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

    await writeLedgerEntry(client, {
      walletId: wallet.id, driverId, entryType: 'ride_consumption',
      amount: fareAmount, direction: 'debit', balanceAfter: newBalance,
      rideId, note: `Ride #${rideId} fare ₹${fareAmount}`,
    })

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Credits a package purchase onto the driver's balance (additive top-up).
export async function creditPackageBalance(
  driverId: bigint,
  thresholdValue: number,
  referenceId: string
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
