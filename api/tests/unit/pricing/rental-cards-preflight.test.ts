import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(join(__dirname, '../../../scripts/preflight-rental-cards.sql'), 'utf-8')

describe('rental cards preflight', () => {
  it('looks for packages whose category has no current rental card (city override or global)', () => {
    expect(sql).toMatch(/FROM rental_packages rp/)
    expect(sql).toMatch(/NOT EXISTS/)
    expect(sql).toMatch(/rc\.ride_type = 'rental'/)
    expect(sql).toMatch(/rc\.effective_to IS NULL/)
    expect(sql).toMatch(/rc\.city_id = rp\.city_id OR rc\.city_id IS NULL/)
  })

  it('only considers active packages and is read-only', () => {
    expect(sql).toMatch(/rp\.is_active/)
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i)
  })

  it('reports package, category and city so the owner can fix each gap', () => {
    expect(sql).toMatch(/rp\.id\s+AS package_id/)
    expect(sql).toMatch(/rp\.category_id/)
    expect(sql).toMatch(/rp\.city_id/)
  })
})
