import { Router, IRouter } from 'express'
import { pool } from '@/db/client'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'

// Airport zones and their toll per vehicle category (migration 150). A zone is a polygon an admin pastes as GeoJSON; it is checked here and
// by PostGIS (valid shape, a sane size) before it is saved. Writes never touch rides already booked: the rates in force are copied onto each ride at
// booking.

export const MAX_ZONE_KM2 = 100
export const MAX_TOLL = 5000

export interface AirportRateInput { category_id: number; amount: number }
export interface AirportZoneInput { name?: string; boundary?: unknown; is_active?: boolean; rates?: AirportRateInput[]; reason?: string }

/** Every change needs a short reason; it is kept with who made it (airport_zone_changes). */
export function checkReason(v: unknown): string {
  const r = typeof v === 'string' ? v.trim() : ''
  if (r.length < 3 || r.length > 300) throw httpError(422, 'Give a reason for this change (3 to 300 characters)', 'VALIDATION_ERROR')
  return r
}

/** A GeoJSON Polygon with a closed outer ring of at least 4 points, as a JSON string ready for ST_GeomFromGeoJSON. */
export function polygonText(v: unknown): string {
  const g = (typeof v === 'string' ? safeParse(v) : v) as { type?: string; coordinates?: unknown } | null
  const ring = g && g.type === 'Polygon' && Array.isArray(g.coordinates) ? (g.coordinates as unknown[])[0] : null
  if (!Array.isArray(ring) || ring.length < 4) throw httpError(422, 'The zone must be a GeoJSON Polygon with at least 3 corners', 'VALIDATION_ERROR')
  for (const pt of ring as unknown[]) {
    if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number' || Math.abs(pt[0]) > 180 || Math.abs(pt[1]) > 90) {
      throw httpError(422, 'The zone has a corner that is not a valid longitude and latitude', 'VALIDATION_ERROR')
    }
  }
  return JSON.stringify({ type: 'Polygon', coordinates: g!.coordinates })
}
function safeParse(s: string): unknown { try { return JSON.parse(s) } catch { return null } }

export function checkRates(rates: unknown): AirportRateInput[] {
  if (!Array.isArray(rates)) throw httpError(422, 'rates must be a list', 'VALIDATION_ERROR')
  const seen = new Set<number>()
  return rates.map((r) => {
    const category_id = Number((r as AirportRateInput)?.category_id)
    const amount = Number((r as AirportRateInput)?.amount)
    if (!Number.isInteger(category_id) || category_id <= 0 || seen.has(category_id)) throw httpError(422, 'Each vehicle type can appear once', 'VALIDATION_ERROR')
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_TOLL) throw httpError(422, `Each toll must be between 0 and ${MAX_TOLL}`, 'VALIDATION_ERROR')
    seen.add(category_id)
    return { category_id, amount }
  })
}

function checkName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : ''
  if (n.length < 2 || n.length > 80) throw httpError(422, 'Give the zone a name of 2 to 80 characters', 'VALIDATION_ERROR')
  return n
}

export async function listZones() {
  const res = await pool.query(
    `SELECT z.id::int AS id, z.name, z.is_active, ST_AsGeoJSON(z.boundary::geometry)::json AS boundary,
            round((ST_Area(z.boundary) / 1000000.0)::numeric, 2)::float8 AS area_km2, z.updated_at,
            COALESCE((SELECT json_agg(json_build_object('category_id', t.category_id::int, 'category_name', vc.display_name, 'amount', t.amount::float8) ORDER BY vc.display_name)
                        FROM airport_toll_rates t JOIN vehicle_categories vc ON vc.id = t.category_id WHERE t.zone_id = z.id), '[]'::json) AS rates
       FROM airport_zones z ORDER BY z.name`,
  )
  return res.rows
}

/** Rejects a shape PostGIS cannot use, or one too big to be an airport (a typo that would charge half a city). */
async function assertUsablePolygon(text: string): Promise<void> {
  let row: { ok: boolean; reason: string | null; km2: number; in_city: boolean } | undefined
  try {
    row = (await pool.query(
      `WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326) AS geom)
       SELECT ST_IsValid(geom) AS ok, ST_IsValidReason(geom) AS reason, ST_Area(geom::geography) / 1000000.0 AS km2,
              EXISTS (SELECT 1 FROM cities c WHERE c.status = 'active' AND c.boundary IS NOT NULL AND ST_Intersects(c.boundary, geom)) AS in_city FROM g`, [text])).rows[0]
  } catch {
    throw httpError(422, 'That shape could not be read as a polygon', 'VALIDATION_ERROR')
  }
  if (!row?.ok) throw httpError(422, `That shape is not valid: ${row?.reason ?? 'unknown'}`, 'VALIDATION_ERROR')
  // An airport sits in one of our cities. A zone touching none is almost always longitude and latitude pasted the wrong way round.
  if (!row.in_city) throw httpError(422, 'That zone is not inside any active city. Check the corners are longitude first, then latitude.', 'ZONE_OUTSIDE_CITIES')
  if (row.km2 > MAX_ZONE_KM2) throw httpError(422, `That zone is ${Math.round(row.km2)} km². An airport zone can be at most ${MAX_ZONE_KM2} km².`, 'ZONE_TOO_LARGE')
}

type Db = { query: typeof pool.query }
async function logChange(c: Db, zoneId: number, zoneName: string, action: 'create' | 'update' | 'delete', adminId: bigint, reason: string, summary: Record<string, unknown>) {
  await c.query('INSERT INTO airport_zone_changes (zone_id, zone_name, action, changed_by, reason, summary) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [zoneId, zoneName, action, adminId, reason, JSON.stringify(summary)])
}

export async function listChanges(limit = 30) {
  const res = await pool.query(
    `SELECT h.id::int AS id, h.zone_id::int AS zone_id, h.zone_name, h.action, h.reason, h.summary, h.created_at, a.email AS changed_by
       FROM airport_zone_changes h LEFT JOIN admins a ON a.id = h.changed_by ORDER BY h.id DESC LIMIT $1`, [limit])
  return res.rows
}

async function saveRates(client: Db, zoneId: number, rates: AirportRateInput[]): Promise<void> {
  await client.query('DELETE FROM airport_toll_rates WHERE zone_id = $1', [zoneId])
  for (const r of rates) {
    await client.query('INSERT INTO airport_toll_rates (zone_id, category_id, amount) VALUES ($1,$2,$3)', [zoneId, r.category_id, r.amount])
  }
}

export async function createZone(input: AirportZoneInput, adminId: bigint) {
  const name = checkName(input.name)
  const text = polygonText(input.boundary)
  const rates = checkRates(input.rates ?? [])
  const reason = checkReason(input.reason)
  await assertUsablePolygon(text)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ins = await client.query<{ id: number }>(
      `INSERT INTO airport_zones (name, boundary, created_by) VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326)::geography, $3) RETURNING id::int AS id`,
      [name, text, adminId])
    await saveRates(client, ins.rows[0]!.id, rates)
    await logChange(client, ins.rows[0]!.id, name, 'create', adminId, reason, { rates })
    await client.query('COMMIT')
    return ins.rows[0]!.id
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally { client.release() }
}

export async function updateZone(id: number, input: AirportZoneInput, adminId: bigint) {
  const name = input.name !== undefined ? checkName(input.name) : undefined
  const text = input.boundary !== undefined ? polygonText(input.boundary) : undefined
  const rates = input.rates !== undefined ? checkRates(input.rates) : undefined
  const reason = checkReason(input.reason)
  if (text) await assertUsablePolygon(text)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const sets: string[] = []; const params: unknown[] = []
    if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`) }
    if (text !== undefined) { params.push(text); sets.push(`boundary = ST_SetSRID(ST_GeomFromGeoJSON($${params.length}::text), 4326)::geography`) }
    if (input.is_active !== undefined) { params.push(Boolean(input.is_active)); sets.push(`is_active = $${params.length}`) }
    params.push(id)
    const exists = sets.length
      ? await client.query(`UPDATE airport_zones SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
      : await client.query('SELECT 1 FROM airport_zones WHERE id = $1', [id])
    if ((exists.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); throw httpError(404, 'Zone not found', 'NOT_FOUND') }
    if (rates) await saveRates(client, id, rates)
    const now = await client.query<{ name: string }>('SELECT name FROM airport_zones WHERE id = $1', [id])
    const summary: Record<string, unknown> = {}
    if (name !== undefined) summary['name'] = name
    if (text !== undefined) summary['boundary_changed'] = true
    if (input.is_active !== undefined) summary['is_active'] = Boolean(input.is_active)
    if (rates) summary['rates'] = rates
    await logChange(client, id, now.rows[0]!.name, 'update', adminId, reason, summary)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally { client.release() }
}

export async function deleteZone(id: number, adminId: bigint, reasonInput: unknown) {
  const reason = checkReason(reasonInput)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<{ name: string }>('DELETE FROM airport_zones WHERE id = $1 RETURNING name', [id])
    if ((res.rowCount ?? 0) === 0) throw httpError(404, 'Zone not found', 'NOT_FOUND')
    await logChange(client, id, res.rows[0]!.name, 'delete', adminId, reason, {})
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally { client.release() }
}

const router: IRouter = Router()
// The admin router already authenticated; ops may manage zones, like cities.
const who = requireAdmin('super_admin', 'ops_admin')
router.get('/', who, async (_req, res, next) => { try { res.json(await listZones()) } catch (e) { next(e) } })
router.get('/changes', who, async (_req, res, next) => { try { res.json(await listChanges()) } catch (e) { next(e) } })
router.post('/', who, async (req, res, next) => { try { res.status(201).json({ id: await createZone(req.body as AirportZoneInput, req.admin!.id) }) } catch (e) { next(e) } })
router.patch('/:id', who, async (req, res, next) => { try { await updateZone(Number(req.params['id']), req.body as AirportZoneInput, req.admin!.id); res.json({ success: true }) } catch (e) { next(e) } })
router.delete('/:id', who, async (req, res, next) => { try { await deleteZone(Number(req.params['id']), req.admin!.id, (req.body as AirportZoneInput | undefined)?.reason); res.status(204).end() } catch (e) { next(e) } })
export default router
