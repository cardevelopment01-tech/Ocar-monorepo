import { describe, it, expect, vi, beforeEach } from 'vitest'

const socket = vi.hoisted(() => ({ connected: true, emit: vi.fn() }))
const api = vi.hoisted(() => ({ post: vi.fn() }))
const session = vi.hoisted(() => ({ sessionId: '9' as string | null }))

vi.mock('@/store/useDriverSessionStore', () => ({ useDriverSessionStore: { getState: () => session } }))

import { emitHeartbeat, resetHeartbeatForTests } from './locationSync'

const deps = { socket, api } as unknown as Parameters<typeof emitHeartbeat>[1]

beforeEach(() => {
  vi.clearAllMocks()
  resetHeartbeatForTests()
  socket.connected = true
  session.sessionId = '9'
  api.post.mockResolvedValue({})
})

describe('driver heartbeat', () => {
  it('sends over the socket when connected', async () => {
    await emitHeartbeat(100_000, deps)
    expect(socket.emit).toHaveBeenCalledWith('driver:heartbeat', { sessionId: '9' })
    expect(api.post).not.toHaveBeenCalled()
  })

  it('falls back to one HTTP call when there is no socket', async () => {
    socket.connected = false
    await emitHeartbeat(100_000, deps)
    expect(api.post).toHaveBeenCalledWith('/api/v1/rides/sessions/heartbeat', { sessionId: '9' })
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('is rate-limited: a task running every 3 s sends one heartbeat per 20 s', async () => {
    await emitHeartbeat(100_000, deps)
    await emitHeartbeat(103_000, deps)
    await emitHeartbeat(119_000, deps)
    await emitHeartbeat(120_000, deps)
    expect(socket.emit).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the driver is not online', async () => {
    session.sessionId = null
    await emitHeartbeat(100_000, deps)
    expect(socket.emit).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('a failed HTTP heartbeat is retried on the next call, not after the full interval', async () => {
    socket.connected = false
    api.post.mockRejectedValueOnce(new Error('offline'))
    await emitHeartbeat(100_000, deps)
    await emitHeartbeat(101_000, deps)
    expect(api.post).toHaveBeenCalledTimes(2)
  })
})
