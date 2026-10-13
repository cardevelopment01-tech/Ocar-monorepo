import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
let responses: { match: RegExp; rows: Row[] }[] = []
const calls: string[] = []
const clientQuery = vi.fn(async (sql: string) => {
  calls.push(sql.replace(/\s+/g, ' ').trim())
  const hit = responses.find((r) => r.match.test(sql))
  return { rows: hit ? hit.rows : [] }
})
const release = vi.fn()
vi.mock('@/db/client', () => ({ pool: { connect: async () => ({ query: clientQuery, release }) } }))
const redisDel = vi.fn().mockResolvedValue(1)
vi.mock('@/db/redis', () => ({ client: { del: (...a: unknown[]) => redisDel(...a) } }))
const audit = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: (...a: unknown[]) => audit(...a) }))

import { deleteAccount } from '@/modules/account/account.service'

const ran = (re: RegExp) => calls.some((c) => re.test(c))

describe('deleteAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calls.length = 0
    responses = [{ match: /FROM (users|drivers) WHERE id/, rows: [{ status: 'active' }] }]
  })

  it('erases a rider: anonymises the row, clears tokens/history/places, revokes sessions, drops the auth cache', async () => {
    await deleteAccount('user', 7n, '1.2.3.4')

    expect(ran(/UPDATE users SET status = 'deleted', phone = 'deleted:' \|\| id, name = NULL, email = NULL/)).toBe(true)
    expect(ran(/DELETE FROM saved_places/)).toBe(true)
    expect(ran(/DELETE FROM device_tokens/)).toBe(true)
    expect(ran(/DELETE FROM notification_logs/)).toBe(true)
    expect(ran(/UPDATE refresh_tokens SET revoked_at/)).toBe(true)
    expect(calls.at(-1)).toBe('COMMIT')
    expect(redisDel).toHaveBeenCalledWith('auth:user:7')
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'account_deleted', targetTable: 'users', targetId: 7n }))
  })

  it('erases a driver: identity numbers, address, bank details and location are cleared; documents are not touched', async () => {
    await deleteAccount('driver', 4n, null)

    expect(ran(/UPDATE drivers SET status = 'deleted'.*aadhaar_number = NULL.*license_number = NULL/)).toBe(true)
    expect(ran(/UPDATE driver_bank_accounts SET account_holder_name = 'deleted'/)).toBe(true)
    expect(ran(/DELETE FROM driver_location_snapshots/)).toBe(true)
    expect(ran(/driver_documents|driver_vehicle_documents/)).toBe(false)
    expect(redisDel).toHaveBeenCalledWith('auth:driver:4')
  })

  it('refuses while a ride is in progress, and changes nothing', async () => {
    responses.push({ match: /FROM rides WHERE/, rows: [{ '?column?': 1 }] })
    await expect(deleteAccount('user', 7n, null)).rejects.toMatchObject({ httpStatus: 409, appCode: 'ACCOUNT_HAS_ACTIVE_RIDE' })
    expect(ran(/UPDATE users/)).toBe(false)
    expect(calls).toContain('ROLLBACK')
    expect(redisDel).not.toHaveBeenCalled()
  })

  it('refuses while the wallet still holds money', async () => {
    responses.push({ match: /FROM user_wallets/, rows: [{ balance: '125.50' }] })
    await expect(deleteAccount('user', 7n, null)).rejects.toMatchObject({ appCode: 'ACCOUNT_HAS_BALANCE' })
    expect(ran(/UPDATE users/)).toBe(false)
  })

  it('refuses a driver whose payout is still being processed', async () => {
    responses.push({ match: /FROM settlements/, rows: [{ '?column?': 1 }] })
    await expect(deleteAccount('driver', 4n, null)).rejects.toMatchObject({ appCode: 'ACCOUNT_HAS_PENDING_PAYOUT' })
    expect(ran(/UPDATE drivers/)).toBe(false)
  })

  it('deleting an already-deleted account is a no-op, not an error', async () => {
    responses = [{ match: /FROM users WHERE id/, rows: [{ status: 'deleted' }] }]
    await expect(deleteAccount('user', 7n, null)).resolves.toBeUndefined()
    expect(ran(/UPDATE users/)).toBe(false)
    expect(audit).not.toHaveBeenCalled()
  })
})
