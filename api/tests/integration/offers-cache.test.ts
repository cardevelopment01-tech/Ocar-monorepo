import { describe, it, expect, afterAll, vi } from 'vitest'
import { pool } from '@/db/client'
import { findActiveOffers, getOfferByCode, invalidateOffers } from '@/modules/offers/offers.repository'

// The active-offer list and a looked-up code are cached for 30 s (offers plan D13). Two traps this pins:
// a cached miss for a code must not outlive the offer being created, and cached rows must survive Redis JSON
// (string ids, ISO dates). Value: protects=a freshly created code is found at once, a paused offer disappears at
// once; fails_when=invalidateOffers stops clearing the per-code miss key; why_new=nothing else covers the cache keys;
// seam=none; no_claim=TTL expiry (invalidation only).

const created: bigint[] = []
const code = `CACHE${Date.now().toString(36).toUpperCase()}`

afterAll(async () => {
  await pool.query(`UPDATE offers SET current_version_id = NULL WHERE id = ANY($1::bigint[])`, [created.map(String)])
  await pool.query(`DELETE FROM offer_versions WHERE offer_id = ANY($1::bigint[])`, [created.map(String)])
  await pool.query(`DELETE FROM offers WHERE id = ANY($1::bigint[])`, [created.map(String)])
  await invalidateOffers(code)
})

async function createActive(withCode: string | null): Promise<bigint> {
  const o = await pool.query(`INSERT INTO offers (name, kind, status, code) VALUES ('cache-test', 'auto', 'active', $1) RETURNING id`, [withCode])
  const id = BigInt(o.rows[0].id)
  created.push(id)
  const v = await pool.query(`INSERT INTO offer_versions (offer_id, version, benefit) VALUES ($1, 1, '{"type":"flat_off","amount":10}') RETURNING id`, [id])
  await pool.query(`UPDATE offers SET current_version_id = $2 WHERE id = $1`, [id, v.rows[0].id])
  return id
}

describe('offer cache', () => {
  it('a second active-offer read inside the TTL runs no offer query', async () => {
    await invalidateOffers()
    await findActiveOffers()
    const spy = vi.spyOn(pool, 'query')
    await findActiveOffers()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('a code looked up before it existed is found right after create + invalidate', async () => {
    expect(await getOfferByCode(code)).toBeNull() // caches the miss
    const id = await createActive(code)
    expect(await getOfferByCode(code)).toBeNull() // still the cached miss
    await invalidateOffers(code)
    expect((await getOfferByCode(code))?.id).toBe(id)
  })

  it('pausing an offer and invalidating drops it from the next list', async () => {
    const id = await createActive(null)
    await invalidateOffers()
    expect((await findActiveOffers()).some((o) => o.id === id)).toBe(true)
    await pool.query(`UPDATE offers SET status = 'paused' WHERE id = $1`, [id])
    await invalidateOffers()
    expect((await findActiveOffers()).some((o) => o.id === id)).toBe(false)
  })
})
