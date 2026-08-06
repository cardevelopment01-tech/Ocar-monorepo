import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import {
  insertMessageIdempotent,
  listMessages,
  markMessagesRead,
} from '@/modules/ride-chat/ride-chat.repository'

const ROW = {
  id: '10',
  ride_id: '1',
  sender_type: 'user',
  sender_id: '5',
  body: 'hi',
  client_msg_id: 'c1',
  read_at: null,
  created_at: '2026-08-06T00:00:00.000Z',
}

describe('insertMessageIdempotent', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns the freshly inserted row + inserted=true when ON CONFLICT inserts', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [ROW], rowCount: 1 } as never)

    const result = await insertMessageIdempotent({
      rideId: 1n, senderType: 'user', senderId: 5n, body: 'hi', clientMsgId: 'c1',
    })

    expect(result.inserted).toBe(true)
    expect(result.message.id).toBe('10')
    // params order: ride_id, sender_type, sender_id, body, client_msg_id
    expect(vi.mocked(pool.query).mock.calls[0]![1]).toEqual([1n, 'user', 5n, 'hi', 'c1'])
    expect(String(vi.mocked(pool.query).mock.calls[0]![0])).toContain('ON CONFLICT')
  })

  it('falls back to SELECT and returns inserted=false when ON CONFLICT DO NOTHING returns no row', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)        // insert hit a duplicate
      .mockResolvedValueOnce({ rows: [ROW], rowCount: 1 } as never)     // fallback SELECT

    const result = await insertMessageIdempotent({
      rideId: 1n, senderType: 'user', senderId: 5n, body: 'hi', clientMsgId: 'c1',
    })

    expect(result.inserted).toBe(false)
    expect(result.message.id).toBe('10')
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2)
    expect(String(vi.mocked(pool.query).mock.calls[1]![0])).toContain('SELECT')
  })
})

describe('listMessages', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('passes rideId and the after cursor (null when omitted)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [ROW], rowCount: 1 } as never)

    await listMessages(1n, undefined)
    expect(vi.mocked(pool.query).mock.calls[0]![1]).toEqual([1n, null])

    await listMessages(1n, 10n)
    expect(vi.mocked(pool.query).mock.calls[1]![1]).toEqual([1n, 10n])
  })
})

describe('markMessagesRead', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('marks unread messages from the OTHER participant as read', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 3 } as never)

    const count = await markMessagesRead(1n, 'driver') // driver is the reader

    expect(count).toBe(3)
    // reader = driver -> mark messages whose sender_type <> 'driver'
    expect(vi.mocked(pool.query).mock.calls[0]![1]).toEqual([1n, 'driver'])
    expect(String(vi.mocked(pool.query).mock.calls[0]![0])).toContain('sender_type <> $2')
  })
})
