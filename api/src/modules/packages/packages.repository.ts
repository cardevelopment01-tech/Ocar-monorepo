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

export async function listActiveTiers(): Promise<PackageTier[]> {
  const res = await pool.query<PackageTier>(
    `SELECT id, label, price, threshold_value, is_active, created_at, updated_at
     FROM package_tiers
     WHERE is_active = true
     ORDER BY price ASC`
  )
  return res.rows
}

export async function getTierById(tierId: bigint): Promise<PackageTier | null> {
  const res = await pool.query<PackageTier>(
    `SELECT id, label, price, threshold_value, is_active, created_at, updated_at
     FROM package_tiers WHERE id = $1`,
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
): Promise<{ id: string; driver_id: string; threshold_value: string } | null> {
  const res = await pool.query<{ id: string; driver_id: string; threshold_value: string }>(
    `UPDATE package_purchase_orders
     SET status = 'completed', razorpay_payment_id = $2, completed_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING id, driver_id, threshold_value`,
    [id, razorpayPaymentId]
  )
  return res.rows[0] ?? null
}
