import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const api = join(__dirname, '../../..')
const migration = readFileSync(join(api, 'src/db/migrations/137_city_ride_rate_cards.sql'), 'utf-8')
const seedPath = join(api, 'scripts/seed-city-ride-cards.sql')

describe('migration 137 is safe to run while old API nodes are still serving', () => {
  it('adds the columns and the index swap but seeds no city rate card (an old node would mix it up with the standard card)', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS trip_mode/)
    expect(migration).toMatch(/rate_cards_current_idx/)
    expect(migration).not.toMatch(/INSERT INTO rate_cards/i)
  })

  it('puts no validating check constraint on the big rides table (it would scan it under an exclusive lock)', () => {
    expect(migration).toMatch(/ALTER TABLE rides\s+ADD COLUMN IF NOT EXISTS trip_mode/)
    expect(migration).not.toMatch(/ALTER TABLE rides\s+ADD CONSTRAINT/i)
    expect(migration).not.toMatch(/VALIDATE CONSTRAINT rides_/i)
  })
})

describe('seed-city-ride-cards.sql (run by the owner when City ride is enabled, after the new API is live everywhere)', () => {
  it('exists', () => { expect(existsSync(seedPath)).toBe(true) })

  const seed = existsSync(seedPath) ? readFileSync(seedPath, 'utf-8') : ''
  it('copies each current rental card into a one_way city card, never updating a rate card, and is safe to re-run', () => {
    expect(seed).toMatch(/INSERT INTO rate_cards/)
    expect(seed).toMatch(/rc\.ride_type = 'rental' AND rc\.effective_to IS NULL/)
    expect(seed).toMatch(/'one_way', 'city'/)
    expect(seed).toMatch(/NOT EXISTS/)
    expect(seed).not.toMatch(/\bUPDATE\s+rate_cards/i)
    expect(seed).not.toMatch(/\bDELETE\b/i)
  })
})
