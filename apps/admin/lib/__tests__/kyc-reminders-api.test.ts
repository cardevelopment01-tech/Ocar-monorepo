import { describe, it, expect, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { summary: {}, rows: [] } }))
vi.mock('../api', () => ({ default: { get } }))

import { kycRemindersApi } from '../kyc-reminders-api'

describe('kycRemindersApi', () => {
  it('calls the versioned admin route, the same prefix every other admin call uses', async () => {
    await kycRemindersApi.report({ result: 'no_device' })
    expect(get).toHaveBeenCalledWith('/api/v1/admin/driver-onboarding/reminders', { params: { result: 'no_device' } })
  })
})
