import type { PoolClient } from 'pg'
import { pool } from '@/db/client'
import { cachedRead, invalidate } from '@/lib/cache/reference-cache'
import { OFFERS_CACHE_TTL_SECONDS } from '@/constants/limits'
import type { Benefit, Rule } from './offers.types'

// ── Offer reads ──────────────────────────────────────────────────────────────

export type OfferKind = 'code' | 'auto' | 'assigned'

/** An offer joined to its current version. Money is plain numbers; ids stay bigint in memory. */
export type OfferRecord = {
  id: bigint
  code: string | null
  name: string
  kind: OfferKind
  status: 'draft' | 'active' | 'paused' | 'ended'
  versionId: bigint
  version: number
  rules: Rule[]
  benefit: Benefit
  perUserLimit: number | null
  stacking: 'exclusive' | 'stackable'
  fundedBy: string
  display: Record<string, unknown>
  budgetTotal: number | null
  budgetSpent: number
  globalLimit: number | null
  redemptionCount: number
  startsAt: Date | null
  endsAt: Date | null
}

// The cache is Redis JSON: JSON.stringify throws on a bigint (and cachedRead then silently serves the DB), and
// Dates come back as strings. So cached rows use string ids and ISO dates.
type CachedOffer = Omit<OfferRecord, 'id' | 'versionId' | 'startsAt' | 'endsAt'> & {
  id: string
  versionId: string
  startsAt: string | null
  endsAt: string | null
}

export function toCachedOffer(o: OfferRecord): CachedOffer {
  return { ...o, id: o.id.toString(), versionId: o.versionId.toString(), startsAt: o.startsAt?.toISOString() ?? null, endsAt: o.endsAt?.toISOString() ?? null }
}

export function fromCachedOffer(c: CachedOffer): OfferRecord {
  return { ...c, id: BigInt(c.id), versionId: BigInt(c.versionId), startsAt: c.startsAt ? new Date(c.startsAt) : null, endsAt: c.endsAt ? new Date(c.endsAt) : null }
}

const OFFER_SELECT = `
  SELECT o.id, o.code::text AS code, o.name, o.kind, o.status,
         v.id AS version_id, v.version, v.rules, v.benefit, v.per_user_limit, v.stacking, v.funded_by, v.display,
         o.budget_total, o.budget_spent, o.global_limit, o.redemption_count, o.starts_at, o.ends_at
    FROM offers o
    JOIN offer_versions v ON v.id = o.current_version_id`

type OfferRow = {
  id: string; code: string | null; name: string; kind: OfferKind; status: OfferRecord['status']
  version_id: string; version: number; rules: Rule[]; benefit: Benefit; per_user_limit: number | null
  stacking: OfferRecord['stacking']; funded_by: string; display: Record<string, unknown>
  budget_total: string | null; budget_spent: string; global_limit: number | null; redemption_count: number
  starts_at: Date | null; ends_at: Date | null
}

function mapOffer(r: OfferRow): OfferRecord {
  return {
    id: BigInt(r.id), code: r.code, name: r.name, kind: r.kind, status: r.status,
    versionId: BigInt(r.version_id), version: r.version, rules: r.rules, benefit: r.benefit,
    perUserLimit: r.per_user_limit, stacking: r.stacking, fundedBy: r.funded_by, display: r.display,
    budgetTotal: r.budget_total == null ? null : parseFloat(r.budget_total), budgetSpent: parseFloat(r.budget_spent),
    globalLimit: r.global_limit, redemptionCount: r.redemption_count, startsAt: r.starts_at, endsAt: r.ends_at,
  }
}

const ACTIVE_KEY = 'offers:active'
const codeKey = (normalized: string) => `offers:code:${normalized}`
export const normalizeCode = (code: string): string => code.trim().replace(/\s+/g, '').toUpperCase()

/** Offers a rider can be matched against right now: active, inside their window, kind auto or assigned/code by id. */
export async function findActiveOffers(): Promise<OfferRecord[]> {
  const cached = await cachedRead<CachedOffer[]>('offers', ACTIVE_KEY, OFFERS_CACHE_TTL_SECONDS, async () => {
    const res = await pool.query<OfferRow>(
      `${OFFER_SELECT}
        WHERE o.status = 'active'
          AND (o.starts_at IS NULL OR o.starts_at <= now())
          AND (o.ends_at IS NULL OR o.ends_at > now())
        ORDER BY o.id`
    )
    return res.rows.map((r) => toCachedOffer(mapOffer(r)))
  })
  return (cached ?? []).map(fromCachedOffer)
}

/** A typed code, case/whitespace-insensitive. A miss is cached per normalized code for 30 s (see invalidateOffers). */
export async function getOfferByCode(code: string): Promise<OfferRecord | null> {
  const normalized = normalizeCode(code)
  if (!normalized) return null
  const cached = await cachedRead<CachedOffer>('offers', codeKey(normalized), OFFERS_CACHE_TTL_SECONDS, async () => {
    const res = await pool.query<OfferRow>(`${OFFER_SELECT} WHERE o.code = $1`, [normalized])
    const row = res.rows[0]
    return row ? toCachedOffer(mapOffer(row)) : null
  })
  return cached ? fromCachedOffer(cached) : null
}

/** Call after an admin write has committed: clears the list and the offer's own code key (including a cached miss). */
export async function invalidateOffers(code?: string | null): Promise<void> {
  await invalidate(ACTIVE_KEY, ...(code ? [codeKey(normalizeCode(code))] : []))
}

// ── Redemption lifecycle ─────────────────────────────────────────────────────

export type ReserveArgs = {
  offerId: bigint
  versionId: bigint
  userId: bigint
  rideId: bigint
  discount: number
  cashback: number
  perUserLimit: number | null
}
export type ReserveResult =
  | { ok: true; redemptionId: bigint }
  | { ok: false; reason: 'BUDGET' | 'GLOBAL_LIMIT' | 'USER_LIMIT' | 'DISABLED' }

/**
 * Reserve a redemption inside the caller's transaction. The per-user count is taken first (no shared row), then the
 * shared offer row last so its lock is held briefly. Any rejection rolls back to a savepoint, so the counters are
 * exactly as before even when the caller carries on and commits.
 */
export async function reserveRedemption(client: PoolClient, a: ReserveArgs): Promise<ReserveResult> {
  await client.query('SAVEPOINT offers_reserve')
  try {
    const usage = await client.query(
      `INSERT INTO offer_user_usage (offer_id, user_id, count) VALUES ($1, $2, 1)
       ON CONFLICT (offer_id, user_id) DO UPDATE SET count = offer_user_usage.count + 1
         WHERE $3::int IS NULL OR offer_user_usage.count < $3::int
       RETURNING count`,
      [a.offerId, a.userId, a.perUserLimit]
    )
    if (usage.rowCount === 0) return await reject(client, 'USER_LIMIT')

    const spend = a.discount + a.cashback
    const offer = await client.query(
      `UPDATE offers
          SET budget_spent = budget_spent + $2, redemption_count = redemption_count + 1
        WHERE id = $1 AND status = 'active'
          AND (budget_total IS NULL OR budget_spent + $2 <= budget_total)
          AND (global_limit IS NULL OR redemption_count < global_limit)
        RETURNING id`,
      [a.offerId, spend]
    )
    if (offer.rowCount === 0) return await reject(client, await whyOfferRefused(client, a.offerId, spend))

    const ins = await client.query<{ id: string }>(
      `INSERT INTO offer_redemptions (offer_id, offer_version_id, user_id, ride_id, status, discount_amount, cashback_amount)
       VALUES ($1, $2, $3, $4, 'reserved', $5, $6) RETURNING id`,
      [a.offerId, a.versionId, a.userId, a.rideId, a.discount, a.cashback]
    )
    await client.query('RELEASE SAVEPOINT offers_reserve')
    return { ok: true, redemptionId: BigInt(ins.rows[0]!.id) }
  } catch (err) {
    // A unique-index hit (a second live redemption for the ride) or any error: undo our increments, let the caller decide.
    await client.query('ROLLBACK TO SAVEPOINT offers_reserve').catch(() => undefined)
    throw err
  }
}

async function reject(client: PoolClient, reason: Extract<ReserveResult, { ok: false }>['reason']): Promise<ReserveResult> {
  await client.query('ROLLBACK TO SAVEPOINT offers_reserve')
  await client.query('RELEASE SAVEPOINT offers_reserve')
  return { ok: false, reason }
}

async function whyOfferRefused(client: PoolClient, offerId: bigint, spend: number): Promise<'BUDGET' | 'GLOBAL_LIMIT' | 'DISABLED'> {
  const r = await client.query<{ status: string; budget_ok: boolean }>(
    `SELECT status, (budget_total IS NULL OR budget_spent + $2 <= budget_total) AS budget_ok FROM offers WHERE id = $1`,
    [offerId, spend]
  )
  const row = r.rows[0]
  if (!row || row.status !== 'active') return 'DISABLED'
  return row.budget_ok ? 'GLOBAL_LIMIT' : 'BUDGET'
}

/** Reserved -> consumed. Idempotent: the first call returns the amounts, later calls (and a released one) return null. */
export async function consumeRedemption(client: Pick<PoolClient, 'query'>, rideId: bigint): Promise<{ discount: number; cashback: number; userId: bigint } | null> {
  const res = await client.query<{ discount_amount: string; cashback_amount: string; user_id: string }>(
    `UPDATE offer_redemptions SET status = 'consumed', consumed_at = now()
      WHERE ride_id = $1 AND status = 'reserved'
      RETURNING discount_amount, cashback_amount, user_id`,
    [rideId]
  )
  const r = res.rows[0]
  return r ? { discount: parseFloat(r.discount_amount), cashback: parseFloat(r.cashback_amount), userId: BigInt(r.user_id) } : null
}

/** Reserved -> released: gives the budget, the global slot and the user's use back. False if there was nothing to release. */
export async function releaseRedemption(client: Pick<PoolClient, 'query'>, rideId: bigint, reason: string): Promise<boolean> {
  return undo(client, rideId, 'reserved', 'released', reason)
}

/** Consumed -> reversed (refund or dispute after the benefit was given). False if it was not consumed. */
export async function reverseRedemption(client: Pick<PoolClient, 'query'>, rideId: bigint, reason: string): Promise<boolean> {
  // The offer WAS used: budget and the global slot come back, the rider's own use does not (refund-and-reuse loop).
  return undo(client, rideId, 'consumed', 'reversed', reason)
}

async function undo(client: Pick<PoolClient, 'query'>, rideId: bigint, from: 'reserved' | 'consumed', to: 'released' | 'reversed', reason: string): Promise<boolean> {
  const res = await client.query<{ offer_id: string; user_id: string; discount_amount: string; cashback_amount: string }>(
    `UPDATE offer_redemptions SET status = $3, released_at = now(), reason = $4
      WHERE ride_id = $1 AND status = $2
      RETURNING offer_id, user_id, discount_amount, cashback_amount`,
    [rideId, from, to, reason]
  )
  const r = res.rows[0]
  if (!r) return false
  const spend = parseFloat(r.discount_amount) + parseFloat(r.cashback_amount)
  await client.query(
    `UPDATE offers SET budget_spent = GREATEST(budget_spent - $2, 0), redemption_count = GREATEST(redemption_count - 1, 0) WHERE id = $1`,
    [r.offer_id, spend]
  )
  if (to === 'released') {
    await client.query(
      `UPDATE offer_user_usage SET count = GREATEST(count - 1, 0) WHERE offer_id = $1 AND user_id = $2`,
      [r.offer_id, r.user_id]
    )
    // The offer went back, so the ride is no longer discounted: every ocar_payable() reader shows the gross fare and a
    // ride an admin later revives is billed in full instead of at a discount nobody holds.
    await client.query(`UPDATE fare_snapshots SET discount_amount = 0 WHERE ride_id = $1`, [rideId])
  }
  return true
}

/** How many times a rider has used each offer, in one query (not one per offer). */
export async function getUserUsage(userId: bigint, offerIds: bigint[]): Promise<Map<bigint, number>> {
  if (offerIds.length === 0) return new Map()
  const res = await pool.query<{ offer_id: string; count: number }>(
    `SELECT offer_id, count FROM offer_user_usage WHERE user_id = $1 AND offer_id = ANY($2::bigint[])`,
    [userId, offerIds.map(String)]
  )
  return new Map(res.rows.map((r) => [BigInt(r.offer_id), r.count]))
}

// ── Admin reads and writes ───────────────────────────────────────────────────

export type NewVersion = {
  rules: Rule[]
  benefit: Benefit
  perUserLimit: number | null
  stacking: 'exclusive' | 'stackable'
  display: Record<string, unknown>
}

export type NewOffer = NewVersion & {
  name: string
  kind: OfferKind
  code: string | null
  status: 'draft' | 'active'
  budgetTotal: number | null
  globalLimit: number | null
  startsAt: string | null
  endsAt: string | null
}

async function insertVersion(client: PoolClient, offerId: bigint, adminId: bigint, v: NewVersion): Promise<{ id: bigint; version: number }> {
  const res = await client.query<{ id: string; version: number }>(
    `INSERT INTO offer_versions (offer_id, version, rules, benefit, per_user_limit, stacking, display, created_by)
     VALUES ($1, COALESCE((SELECT MAX(version) FROM offer_versions WHERE offer_id = $1), 0) + 1, $2::jsonb, $3::jsonb, $4, $5, $6::jsonb, $7)
     RETURNING id, version`,
    [offerId, JSON.stringify(v.rules), JSON.stringify(v.benefit), v.perUserLimit, v.stacking, JSON.stringify(v.display), adminId]
  )
  const row = res.rows[0]!
  await client.query(`UPDATE offers SET current_version_id = $2 WHERE id = $1`, [offerId, row.id])
  return { id: BigInt(row.id), version: row.version }
}

export async function createOfferTx(client: PoolClient, adminId: bigint, o: NewOffer): Promise<{ offerId: bigint; versionId: bigint }> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO offers (name, kind, code, status, budget_total, global_limit, starts_at, ends_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [o.name, o.kind, o.code, o.status, o.budgetTotal, o.globalLimit, o.startsAt, o.endsAt, adminId]
  )
  const offerId = BigInt(res.rows[0]!.id)
  const v = await insertVersion(client, offerId, adminId, o)
  return { offerId, versionId: v.id }
}

/** Locks the offer row so two admins saving at once get version N+1 and N+2, never two N+1. */
export async function createVersionTx(client: PoolClient, adminId: bigint, offerId: bigint, v: NewVersion): Promise<{ versionId: bigint; version: number } | null> {
  const lock = await client.query(`SELECT 1 FROM offers WHERE id = $1 FOR UPDATE`, [offerId])
  if (lock.rowCount === 0) return null
  const created = await insertVersion(client, offerId, adminId, v)
  return { versionId: created.id, version: created.version }
}

export type OfferPatch = {
  name?: string
  status?: 'draft' | 'active' | 'paused' | 'ended'
  endsAt?: string | null
  budgetTotal?: number | null
  globalLimit?: number | null
  display?: Record<string, unknown>
}

export type AdminOfferRow = {
  id: string; code: string | null; name: string; kind: OfferKind; status: string; version: number | null
  summary_rules: Rule[] | null; summary_benefit: Benefit | null; display: Record<string, unknown> | null
  budget_total: string | null; budget_spent: string; global_limit: number | null; redemption_count: number
  starts_at: Date | null; ends_at: Date | null; created_at: Date; updated_at: Date
}

const ADMIN_SELECT = `
  SELECT o.id, o.code::text AS code, o.name, o.kind, o.status, v.version, v.rules AS summary_rules, v.benefit AS summary_benefit,
         v.display, o.budget_total, o.budget_spent, o.global_limit, o.redemption_count, o.starts_at, o.ends_at, o.created_at, o.updated_at
    FROM offers o LEFT JOIN offer_versions v ON v.id = o.current_version_id`

export async function listOffersAdmin(f: { status?: string; search?: string; limit: number; offset: number }): Promise<AdminOfferRow[]> {
  const res = await pool.query<AdminOfferRow>(
    `${ADMIN_SELECT}
      WHERE ($1::text IS NULL OR o.status = $1)
        AND ($2::text IS NULL OR o.name ILIKE '%' || $2 || '%' OR o.code::text ILIKE '%' || $2 || '%')
      ORDER BY o.id DESC LIMIT $3 OFFSET $4`,
    [f.status ?? null, f.search ?? null, f.limit, f.offset]
  )
  return res.rows
}

export async function getOfferAdmin(offerId: bigint): Promise<{ offer: AdminOfferRow; versions: { id: string; version: number; rules: Rule[]; benefit: Benefit; per_user_limit: number | null; stacking: string; display: Record<string, unknown>; created_at: Date }[] } | null> {
  const o = await pool.query<AdminOfferRow>(`${ADMIN_SELECT} WHERE o.id = $1`, [offerId])
  if (!o.rows[0]) return null
  const v = await pool.query(
    `SELECT id, version, rules, benefit, per_user_limit, stacking, display, created_at FROM offer_versions WHERE offer_id = $1 ORDER BY version DESC`,
    [offerId]
  )
  return { offer: o.rows[0], versions: v.rows }
}

export async function lockOfferForUpdate(client: PoolClient, offerId: bigint): Promise<{ status: string; budget_total: string | null; budget_spent: string; starts_at: Date | null; code: string | null } | null> {
  const r = await client.query(`SELECT status, budget_total, budget_spent, starts_at, code::text AS code FROM offers WHERE id = $1 FOR UPDATE`, [offerId])
  return r.rows[0] ?? null
}

export async function patchOfferTx(client: PoolClient, offerId: bigint, p: OfferPatch): Promise<void> {
  // Hardcoded column names only; values are bound.
  const sets: string[] = []
  const vals: unknown[] = [offerId]
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`) }
  if (p.name !== undefined) add('name', p.name)
  if (p.status !== undefined) add('status', p.status)
  if (p.endsAt !== undefined) add('ends_at', p.endsAt)
  if (p.budgetTotal !== undefined) add('budget_total', p.budgetTotal)
  if (p.globalLimit !== undefined) add('global_limit', p.globalLimit)
  if (sets.length > 0) await client.query(`UPDATE offers SET ${sets.join(', ')} WHERE id = $1`, vals)
  // Display copy is the one thing editable in place on a version (plan D7).
  if (p.display !== undefined) {
    await client.query(`UPDATE offer_versions SET display = $2::jsonb WHERE id = (SELECT current_version_id FROM offers WHERE id = $1)`, [offerId, JSON.stringify(p.display)])
  }
}

export async function offerStats(offerId: bigint) {
  const r = await pool.query(
    `SELECT status, count(*)::int AS n, COALESCE(sum(discount_amount), 0)::float8 AS discount, COALESCE(sum(cashback_amount), 0)::float8 AS cashback
       FROM offer_redemptions WHERE offer_id = $1 GROUP BY status`,
    [offerId]
  )
  return r.rows as { status: string; n: number; discount: number; cashback: number }[]
}

export type RedemptionFilter = { status?: string; from?: string; to?: string }

export async function listRedemptions(offerId: bigint, limit: number, offset: number, f: RedemptionFilter = {}) {
  const r = await pool.query(
    `SELECT id, user_id, ride_id, status, discount_amount, cashback_amount, reserved_at, consumed_at, released_at, reason
       FROM offer_redemptions
      WHERE offer_id = $1
        AND ($4::text IS NULL OR status = $4)
        AND ($5::timestamptz IS NULL OR reserved_at >= $5)
        AND ($6::timestamptz IS NULL OR reserved_at < $6)
      ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [offerId, limit, offset, f.status ?? null, f.from ?? null, f.to ?? null]
  )
  return r.rows
}

/** How many offers sit in each status, for the list tabs. One cheap grouped count. */
export async function offerStatusCounts(): Promise<Record<string, number>> {
  const r = await pool.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM offers GROUP BY status`)
  return Object.fromEntries(r.rows.map((x) => [x.status, x.n]))
}

/** Offers a rider can see: active auto offers plus any granted to them. Never a code offer (it appears once typed). */
export async function listGrantedOfferIds(userId: bigint): Promise<bigint[]> {
  const r = await pool.query<{ offer_id: string }>(
    `SELECT offer_id FROM user_offers WHERE user_id = $1 AND status = 'available' AND (expires_at IS NULL OR expires_at > now())`,
    [userId]
  )
  return r.rows.map((x) => BigInt(x.offer_id))
}

/**
 * Rides that carry an offer discount and have not been paid yet. Commission is read when a ride settles, so restoring
 * the rate while these are open charges commission on their discounted fare (review decision D21): the Config page warns
 * the admin with this number. Cheap and rare (only on an admin save of commission_percent).
 */
export async function openDiscountedRideCount(): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM fare_snapshots fs
       JOIN rides r ON r.id = fs.ride_id
      WHERE fs.discount_amount > 0
        AND r.status NOT IN ('cancelled', 'no_drivers')
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.ride_id = r.id AND p.status = 'completed')`
  )
  return Number(res.rows[0]?.n ?? 0)
}
