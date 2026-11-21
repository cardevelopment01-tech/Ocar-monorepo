import { pool } from '@/db/client'
import type { PackageTier, DriverPackageWallet, DriverPackageLedgerEntry } from './packages.types'

export async function getPackageWallet(driverId: bigint): Promise<DriverPackageWallet | null> {
  const res = await pool.query<DriverPackageWallet>(
    `SELECT id, driver_id, balance, is_frozen, frozen_reason, lifetime_topup, lifetime_consumed
     FROM driver_package_wallets
     WHERE driver_id = $1`,
    [driverId]
  )
  return res.rows[0] ?? null
}

const TIER_COLS = 'id, label, price, threshold_value, is_active, vehicle_group, validity_days, created_at, updated_at'

/** The active plans for one vehicle group (cab or auto), cheapest first. */
export async function listActiveTiers(group: 'cab' | 'auto'): Promise<PackageTier[]> {
  const res = await pool.query<PackageTier>(
    `SELECT ${TIER_COLS} FROM package_tiers WHERE is_active = true AND vehicle_group = $1 ORDER BY price ASC`,
    [group]
  )
  return res.rows
}

/** The slug of the driver's primary vehicle category, or null when none is registered yet. */
export async function getDriverCategorySlug(driverId: bigint): Promise<string | null> {
  const res = await pool.query<{ slug: string }>(
    `SELECT vc.slug FROM driver_vehicles dv JOIN vehicle_categories vc ON vc.id = dv.category_id
      WHERE dv.driver_id = $1 ORDER BY dv.is_primary DESC, dv.id ASC LIMIT 1`,
    [driverId]
  )
  return res.rows[0]?.slug ?? null
}

export async function getTierById(tierId: bigint): Promise<PackageTier | null> {
  const res = await pool.query<PackageTier>(
    `SELECT ${TIER_COLS} FROM package_tiers WHERE id = $1`,
    [tierId]
  )
  return res.rows[0] ?? null
}

export async function listLedgerForDriver(driverId: bigint, limit = 50): Promise<DriverPackageLedgerEntry[]> {
  const res = await pool.query<DriverPackageLedgerEntry>(
    `SELECT id, entry_type, amount, direction, balance_after, ride_id, reference_id, note, created_at
     FROM driver_package_ledger
     WHERE driver_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [driverId, limit]
  )
  return res.rows
}

export async function createPurchaseOrder(args: {
  driverId: bigint
  tierId: bigint
  amount: number
  thresholdValue: number
  razorpayOrderId: string
}): Promise<{ id: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO package_purchase_orders
       (driver_id, package_tier_id, amount, threshold_value, razorpay_order_id, status)
     VALUES ($1,$2,$3,$4,$5,'pending')
     RETURNING id`,
    [args.driverId, args.tierId, args.amount, args.thresholdValue, args.razorpayOrderId]
  )
  return res.rows[0]!
}

// WHERE status = 'pending' is the same idempotency gate confirmRidePayment uses:
// once markPurchaseCompleted flips this row to 'completed', a replayed/retried
// webhook for the same order finds nothing here and no-ops.
export async function findPendingPurchaseByOrderId(
  razorpayOrderId: string
): Promise<{ id: string; driver_id: string; threshold_value: string } | null> {
  const res = await pool.query<{ id: string; driver_id: string; threshold_value: string }>(
    `SELECT id, driver_id, threshold_value FROM package_purchase_orders
     WHERE razorpay_order_id = $1 AND status = 'pending'`,
    [razorpayOrderId]
  )
  return res.rows[0] ?? null
}

// Atomic claim-and-check (mirrors confirmRidePayment's own guard): the
// WHERE status='pending' runs as part of the same UPDATE, so concurrent
// webhook deliveries for the same order can only have one winner — the
// loser gets no row back and must not credit the wallet.
export async function markPurchaseCompleted(
  id: string,
  razorpayPaymentId: string
): Promise<{ id: string; driver_id: string; threshold_value: string; validity_days: number } | null> {
  const res = await pool.query<{ id: string; driver_id: string; threshold_value: string; validity_days: number }>(
    `UPDATE package_purchase_orders
     SET status = 'completed', razorpay_payment_id = $2, completed_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING id, driver_id, threshold_value, validity_days`,
    [id, razorpayPaymentId]
  )
  return res.rows[0] ?? null
}

/** `amount` is what the driver is charged (price + GST); priceAmount/gstPercent/gstAmount record how it splits. */
export async function createPayuPurchaseOrder(args: {
  driverId: bigint
  tierId: bigint
  amount: number
  priceAmount: number
  gstPercent: number
  gstAmount: number
  validityDays: number
  thresholdValue: number
  txnId: string
}): Promise<{ id: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO package_purchase_orders
       (driver_id, package_tier_id, amount, price_amount, gst_percent, gst_amount, validity_days, threshold_value, gateway, gateway_txn_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'payu',$9,'pending')
     RETURNING id`,
    [args.driverId, args.tierId, args.amount, args.priceAmount, args.gstPercent, args.gstAmount, args.validityDays, args.thresholdValue, args.txnId]
  )
  return res.rows[0]!
}

// No status filter on purpose: the notification funnel needs to tell
// "already completed" (no-op success) from "unknown txn" (money unaccounted for).
export async function findPurchaseByTxnId(txnId: string): Promise<{
  id: string; driver_id: string; package_tier_id: string; threshold_value: string; amount: string; status: string
  gateway_payment_id: string | null; validity_days: number
} | null> {
  const res = await pool.query(
    `SELECT id, driver_id, package_tier_id, threshold_value, amount, status, gateway_payment_id, validity_days
     FROM package_purchase_orders WHERE gateway_txn_id = $1`,
    [txnId]
  )
  return res.rows[0] ?? null
}

// Same atomic claim as markPurchaseCompleted: WHERE status='pending' is in the UPDATE.
export async function markPurchaseCompletedPayu(
  id: string,
  paymentId: string
): Promise<{ id: string; driver_id: string; threshold_value: string; validity_days: number } | null> {
  const res = await pool.query(
    `UPDATE package_purchase_orders
     SET status = 'completed', gateway_payment_id = $2, completed_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING id, driver_id, threshold_value, validity_days`,
    [id, paymentId]
  )
  return res.rows[0] ?? null
}

/** The driver's credit that has not yet expired or been used up, soonest expiry first. */
export async function listLiveLots(driverId: bigint): Promise<Array<{ remaining: string; expires_at: string }>> {
  const res = await pool.query<{ remaining: string; expires_at: string }>(
    `SELECT remaining::text, expires_at FROM package_credit_lots
      WHERE driver_id = $1 AND expired_at IS NULL AND remaining > 0 ORDER BY expires_at ASC, id ASC`,
    [driverId]
  )
  return res.rows
}
