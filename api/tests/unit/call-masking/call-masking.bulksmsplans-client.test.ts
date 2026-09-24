import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/config', () => ({
  config: {
    BULKSMSPLANS_API_ID: 'id',
    BULKSMSPLANS_API_PASSWORD: 'pw',
    BULKSMSPLANS_IVR_NUMBER: '7971123156',
  },
}))

import { makeCall } from '@/modules/call-masking/call-masking.bulksmsplans-client'

describe('bulksmsplans client — number normalization', () => {
  beforeEach(() => vi.restoreAllMocks())

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, message: 'ok' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('strips a +91 country code down to the bare 10-digit number', async () => {
    const fetchMock = stubFetch()
    await makeCall({ receiverNumber: '+919876543210', agentNumber: '+919000000001' })
    const body = Object.fromEntries(new URL(fetchMock.mock.calls[0]![0] as string).searchParams)
    expect(body.receiver_number).toBe('9876543210')
    expect(body.agent_number).toBe('9000000001')
  })

  it('strips a bare 91 country code (no +) down to the bare 10-digit number', async () => {
    const fetchMock = stubFetch()
    await makeCall({ receiverNumber: '919876543210', agentNumber: '9000000001' })
    const body = Object.fromEntries(new URL(fetchMock.mock.calls[0]![0] as string).searchParams)
    expect(body.receiver_number).toBe('9876543210')
  })

  it('does NOT corrupt a valid 10-digit number that happens to start with 91', async () => {
    const fetchMock = stubFetch()
    await makeCall({ receiverNumber: '9123456789', agentNumber: '9000000001' })
    const body = Object.fromEntries(new URL(fetchMock.mock.calls[0]![0] as string).searchParams)
    expect(body.receiver_number).toBe('9123456789')
  })

  it('sends the exact query the vendor confirmed working (GET, lowercase dial=agent)', async () => {
    const fetchMock = stubFetch()
    await makeCall({ receiverNumber: '9876543210', agentNumber: '9000000001' })
    const url = new URL(fetchMock.mock.calls[0]![0] as string)
    expect(url.origin + url.pathname).toBe('https://www.bulksmsplans.com/api/ivr/makeACall')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_id: 'id',
      api_password: 'pw',
      ivr_number: '7971123156',
      dial: 'agent',
      receiver_number: '9876543210',
      agent_number: '9000000001',
    })
  })
})
