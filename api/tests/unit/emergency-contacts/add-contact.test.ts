import { describe, it, expect, vi, beforeEach } from 'vitest'

const q = vi.hoisted(() => ({ query: vi.fn(), client: { query: vi.fn() } }))
vi.mock('@/db/client', () => ({
  query: q.query,
  withTransaction: async (fn: (c: typeof q.client) => Promise<unknown>) => fn(q.client),
}))

import { addContact } from '@/modules/emergency-contacts/emergency-contacts.service'

// The repository runs these statements in order inside one transaction: lock the user's row, list, insert.
function script(existing: string[], ownPhone = '+919000000001') {
  q.client.query.mockReset()
  q.client.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM users')) return { rows: [{ phone: ownPhone }] }
    if (sql.includes('FROM user_emergency_contacts')) return { rows: existing.map((phone) => ({ phone })) }
    if (sql.includes('INSERT INTO user_emergency_contacts')) return { rows: [{ id: '9', name: 'N', phone: '+919111111111' }] }
    return { rows: [] }
  })
}

beforeEach(() => vi.clearAllMocks())

describe('addContact', () => {
  it('locks the user row before counting, so simultaneous adds cannot all pass the limit', async () => {
    script([])
    await addContact(5n, 'N', '+919111111111')
    const calls = q.client.query.mock.calls.map((c) => String(c[0]))
    expect(calls[0]).toContain('FROM users')
    expect(calls[0]).toContain('FOR UPDATE')
    expect(calls.findIndex((s) => s.includes('FROM user_emergency_contacts'))).toBeGreaterThan(0)
    expect(calls.some((s) => s.includes('INSERT INTO user_emergency_contacts'))).toBe(true)
  })

  it('refuses a fourth contact with 422 and inserts nothing', async () => {
    script(['+919111111111', '+919222222222', '+919333333333'])
    await expect(addContact(5n, 'N', '+919444444444')).rejects.toMatchObject({ httpStatus: 422, appCode: 'EMERGENCY_CONTACT_LIMIT' })
    expect(q.client.query.mock.calls.some((c) => String(c[0]).includes('INSERT'))).toBe(false)
  })

  it('refuses a duplicate number with 409', async () => {
    script(['+919111111111'])
    await expect(addContact(5n, 'N', '+919111111111')).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('refuses the rider\'s own number', async () => {
    script([], '+919555555555')
    await expect(addContact(5n, 'N', '+919555555555')).rejects.toMatchObject({ httpStatus: 422 })
  })
})
