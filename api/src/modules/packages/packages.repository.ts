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
