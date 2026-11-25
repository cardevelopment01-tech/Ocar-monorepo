import { describe, it, expect } from 'vitest'
import { redactAudit, changedFields, REDACTED } from '@/lib/audit-redact'
import { deriveAdminAction } from '@/middleware/admin-activity.middleware'
import { isRiskyAction, humanizeAction } from '@/lib/audit-log'
import { buildWhere } from '@/modules/admin-audit/admin-audit.repository'

describe('redactAudit', () => {
  it('replaces secret-looking keys at any depth and never mutates the input', () => {
    const input = { password: 'a', nested: { otp: '123456', authToken: 'x', ok: 1 }, list: [{ api_key: 'k' }], password_hash: 'h' }
    const out = redactAudit(input)!
    expect(out['password']).toBe(REDACTED)
    expect((out['nested'] as Record<string, unknown>)['otp']).toBe(REDACTED)
    expect((out['nested'] as Record<string, unknown>)['authToken']).toBe(REDACTED)
    expect((out['nested'] as Record<string, unknown>)['ok']).toBe(1)
    expect(((out['list'] as Record<string, unknown>[])[0]!)['api_key']).toBe(REDACTED)
    expect(out['password_hash']).toBe(REDACTED)
    expect(input.password).toBe('a')
  })

  it('does not mistake ordinary words for secrets', () => {
    const out = redactAudit({ footprint: 'f', bypass_reason: 'r', company: 'c', status: 's' })!
    expect(out['footprint']).toBe('f')
    expect(out['company']).toBe('c')
  })

  it('keeps only the last 4 digits of phones and strips signed-URL queries', () => {
    const out = redactAudit({ phone: '+91 98765 43210', photo_url: 'https://x.s3.amazonaws.com/a.jpg?X-Amz-Signature=zzz' })!
    expect(out['phone']).toBe('********3210')
    expect(out['photo_url']).toBe('https://x.s3.amazonaws.com/a.jpg')
  })

  it('caps depth, arrays, strings and total size', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }
    expect(JSON.stringify(redactAudit(deep))).toContain('[nested]')
    const arr = redactAudit({ xs: Array.from({ length: 80 }, (_, i) => i) })!
    expect((arr['xs'] as unknown[]).length).toBe(51)
    const huge = redactAudit(Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, 'x'.repeat(1900)])))!
    expect(huge['_truncated']).toBe(true)
  })

  it('returns null for null and undefined', () => {
    expect(redactAudit(null)).toBeNull()
    expect(redactAudit(undefined)).toBeNull()
  })
})

describe('changedFields', () => {
  it('lists top-level keys whose value changed, including added and removed ones', () => {
    expect(changedFields({ a: 1, b: 2, c: { x: 1 } }, { a: 1, b: 3, c: { x: 1 }, d: 4 })).toEqual(['b', 'd'])
    expect(changedFields(null, { a: 1 })).toEqual(['a'])
    expect(changedFields(null, null)).toBeNull()
  })
})

describe('deriveAdminAction', () => {
  it('names actions from the route and finds the target', () => {
    expect(deriveAdminAction('PATCH', '/drivers/12/status')).toMatchObject({ action: 'drivers.status', targetTable: 'drivers', targetId: 12n })
    expect(deriveAdminAction('POST', '/pricing/rate-cards')).toMatchObject({ action: 'pricing.rate-cards.create', targetTable: 'pricing', targetId: null })
    expect(deriveAdminAction('DELETE', '/drivers/12')).toMatchObject({ action: 'drivers.delete', targetId: 12n })
    expect(deriveAdminAction('PATCH', '/safety/sos/7/resolve')).toMatchObject({ action: 'safety.sos.resolve', targetId: 7n })
    expect(deriveAdminAction('PUT', '/geo/cities/3/boundary')).toMatchObject({ action: 'geo.cities.boundary', targetId: 3n })
    expect(deriveAdminAction('POST', '/rides/9/force-resolve')).toMatchObject({ action: 'rides.force-resolve', targetId: 9n })
  })

  it('treats uuids as ids and ignores query strings and trailing slashes', () => {
    const d = deriveAdminAction('PATCH', '/offers/3f2b8c1e-1111-4222-8333-444455556666/cancel/?x=1')
    expect(d.action).toBe('offers.cancel')
    expect(d.path).toBe('/offers/3f2b8c1e-1111-4222-8333-444455556666/cancel')
  })
})

describe('risky actions', () => {
  it('flags money, role and config changes only when they succeeded', () => {
    expect(isRiskyAction('drivers.delete')).toBe(true)
    expect(isRiskyAction('drivers.package.balance')).toBe(true)
    expect(isRiskyAction('system_config.update')).toBe(true)
    expect(isRiskyAction('drivers.status_change')).toBe(false)
    expect(isRiskyAction('drivers.delete', 'denied')).toBe(false)
  })
  it('humanizes action names', () => {
    expect(humanizeAction('drivers.status_change')).toBe('Drivers status change')
  })
})

describe('buildWhere', () => {
  it('parameterises everything and escapes LIKE wildcards', () => {
    const { conds, params } = buildWhere({ actions: ['drivers.*', 'a_b'], q: '50%_off', adminId: '3' })
    const sql = conds.join(' AND ')
    expect(sql).not.toContain('50%')
    expect(params).toContain('drivers.%')
    expect(params).toContain('%50\\%\\_off%')
    expect(sql).toMatch(/\$1::bigint/)
  })
  it('treats an all-digit search as an id lookup', () => {
    const { conds } = buildWhere({ q: '123' })
    expect(conds[0]).toContain('target_id')
  })
})
