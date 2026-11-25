import { describe, it, expect } from 'vitest'
import {
  EMPTY_FILTERS, actionGroup, activeFilterCount, describeClient, diffRows, filtersToParams, formatValue, humanizeAction,
  initials, isRiskyAction, outcomeLabel, relativeTime, targetHref,
} from '../audit-log-model'

const NOW = new Date('2026-11-25T12:00:00.000Z')

describe('filtersToParams', () => {
  it('sends nothing for the empty filter', () => {
    expect(filtersToParams(EMPTY_FILTERS, NOW)).toEqual({})
  })

  it('maps filters to API params and trims the search', () => {
    const p = filtersToParams({ ...EMPTY_FILTERS, q: '  fraud ', adminId: '4', actions: ['drivers.delete', 'cities.*'], outcome: 'denied', targetTable: 'drivers', targetId: '9' }, NOW)
    expect(p).toEqual({ q: 'fraud', admin_id: '4', action: 'drivers.delete,cities.*', outcome: 'denied', target_table: 'drivers', target_id: '9' })
  })

  it('turns presets into a from timestamp relative to now', () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, range: '24h' }, NOW)['from']).toBe('2026-11-24T12:00:00.000Z')
    expect(filtersToParams({ ...EMPTY_FILTERS, range: '7d' }, NOW)['from']).toBe('2026-11-18T12:00:00.000Z')
  })

  it('makes a custom "to" date inclusive of that whole day', () => {
    const p = filtersToParams({ ...EMPTY_FILTERS, range: 'custom', from: '2026-11-10', to: '2026-11-12' }, NOW)
    const to = new Date(p['to']!)
    const from = new Date(p['from']!)
    expect(to.getTime() - from.getTime()).toBe(3 * 24 * 3600_000)
  })

  it('counts active filters, with actions and range counted once each', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: 'x', actions: ['a', 'b'], range: '7d', outcome: 'failure' })).toBe(4)
  })
})

describe('diffRows', () => {
  it('lists only what changed and flattens nested fields', () => {
    const rows = diffRows({ status: 'active', city: { id: 1, name: 'A' }, same: 1 }, { status: 'suspended', city: { id: 1, name: 'B' }, same: 1, note: 'x' })
    expect(rows.map(r => [r.field, r.kind])).toEqual([['city.name', 'changed'], ['note', 'added'], ['status', 'changed']])
  })

  it('marks removed fields and copes with null sides', () => {
    expect(diffRows({ a: 1 }, null)).toEqual([{ field: 'a', before: 1, after: null, kind: 'removed' }])
    expect(diffRows(null, { a: 1 })).toEqual([{ field: 'a', before: null, after: 1, kind: 'added' }])
    expect(diffRows(null, null)).toEqual([])
  })

  it('treats equal arrays as unchanged', () => {
    expect(diffRows({ ids: [1, 2] }, { ids: [1, 2] })).toEqual([])
    expect(diffRows({ ids: [1, 2] }, { ids: [1, 3] })).toHaveLength(1)
  })
})

describe('naming', () => {
  it('humanizes and groups actions', () => {
    expect(humanizeAction('drivers.status_change')).toBe('Drivers status change')
    expect(actionGroup('auth.admin.login')).toBe('Sign-in')
    expect(actionGroup('drivers.delete')).toBe('Drivers')
    expect(actionGroup('pricing.rate-cards.create')).toBe('Pricing')
    expect(actionGroup('mystery')).toBe('Other')
  })

  it('labels outcomes in plain words', () => {
    expect([outcomeLabel('success'), outcomeLabel('denied'), outcomeLabel('failure')]).toEqual(['Done', 'Blocked', 'Failed'])
  })

  it('agrees with the API on which actions are sensitive', () => {
    expect(isRiskyAction('drivers.package.balance')).toBe(true)
    expect(isRiskyAction('drivers.status_change')).toBe(false)
  })
})

describe('display helpers', () => {
  it('shows relative time for recent entries and a date for old ones', () => {
    expect(relativeTime('2026-11-25T11:59:50.000Z', NOW)).toBe('just now')
    expect(relativeTime('2026-11-25T11:30:00.000Z', NOW)).toBe('30 min ago')
    expect(relativeTime('2026-11-25T07:00:00.000Z', NOW)).toBe('5 h ago')
    expect(relativeTime('2026-11-22T12:00:00.000Z', NOW)).toBe('3 d ago')
    expect(relativeTime('2026-01-05T12:00:00.000Z', NOW)).toMatch(/2026/)
  })

  it('summarises the browser and OS, and survives missing data', () => {
    expect(describeClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')).toBe('Chrome on Windows')
    expect(describeClient('axios/1.6')).toBe('Script / API client')
    expect(describeClient(null)).toBe('Unknown device')
  })

  it('makes initials from an email and falls back for system rows', () => {
    expect(initials('sujal.ghosh@ocar.app')).toBe('SG')
    expect(initials('ops@ocar.app')).toBe('OP')
    expect(initials(null)).toBe('SY')
  })

  it('formats values for the diff table', () => {
    expect(formatValue(null)).toBe('—')
    expect(formatValue('')).toBe('(empty)')
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
  })

  it('links only targets the admin app can open', () => {
    expect(targetHref('drivers', '12')).toBe('/drivers/12')
    expect(targetHref('cities', '3')).toBeNull()
    expect(targetHref('drivers', null)).toBeNull()
  })
})
