import { describe, it, expect, vi, beforeEach } from 'vitest'

type Ack = (err: unknown, res?: { ok?: boolean }) => void
const sock = vi.hoisted(() => ({
  connected: true,
  // what the fake server does with a heartbeat: 'ack' | 'silent' (half-dead connection) | 'timeout' (socket.io reports a timeout error)
  mode: 'ack' as 'ack' | 'silent' | 'timeout',
  emitted: [] as Array<{ event: string; payload: unknown }>,
}))
const socket = {
  get connected() { return sock.connected },
  timeout: () => ({
    emit: (event: string, payload: unknown, cb: Ack) => {
      sock.emitted.push({ event, payload })
      if (sock.mode === 'ack') cb(null, { ok: true })
      else if (sock.mode === 'timeout') cb(new Error('operation has timed out'))
    },
  }),
}
const api = vi.hoisted(() => ({ post: vi.fn() }))
const session = vi.hoisted(() => ({ sessionId: '9' as string | null }))
const disk = vi.hoisted(() => ({ id: null as string | null }))

vi.mock('@/store/useDriverSessionStore', () => ({ useDriverSessionStore: { getState: () => session } }))
vi.mock('./persistedSession', () => ({ readPersistedSessionId: async () => disk.id }))

import { emitHeartbeat, resetHeartbeatForTests } from './locationSync'

const deps = { socket, api } as unknown as Parameters<typeof emitHeartbeat>[1]

beforeEach(() => {
  vi.clearAllMocks()
  resetHeartbeatForTests()
  sock.connected = true; sock.mode = 'ack'; sock.emitted.length = 0
  session.sessionId = '9'; disk.id = null
  api.post.mockResolvedValue({})
})

describe('driver heartbeat', () => {
  it('goes over the socket and is confirmed: no HTTP call', async () => {
    await emitHeartbeat(100_000, deps)
    expect(sock.emitted).toEqual([{ event: 'driver:heartbeat', payload: { sessionId: '9' } }])
    expect(api.post).not.toHaveBeenCalled()
  })

  it('a connected socket that never answers (half dead) falls back to HTTP', async () => {
    sock.mode = 'timeout'
    await emitHeartbeat(100_000, deps)
    expect(api.post).toHaveBeenCalledWith('/api/v1/rides/sessions/heartbeat', { sessionId: '9' })
  })

  it('no socket at all: one HTTP call', async () => {
    sock.connected = false
    await emitHeartbeat(100_000, deps)
    expect(sock.emitted).toHaveLength(0)
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('is rate-limited: a task running every 3 s sends one heartbeat per 20 s', async () => {
    await emitHeartbeat(100_000, deps)
    await emitHeartbeat(103_000, deps)
    await emitHeartbeat(119_000, deps)
    await emitHeartbeat(120_000, deps)
    expect(sock.emitted).toHaveLength(2)
  })

  it('does nothing when there is no session anywhere', async () => {
    session.sessionId = null
    await emitHeartbeat(100_000, deps)
    expect(sock.emitted).toHaveLength(0)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('a bare background process (session store empty after the app was killed) uses the session id saved on disk', async () => {
    session.sessionId = null; disk.id = '42'
    await emitHeartbeat(100_000, deps)
    expect(sock.emitted[0]?.payload).toEqual({ sessionId: '42' })
  })

  it('a failed HTTP heartbeat is retried on the next call, not after the full interval (a short network blip)', async () => {
    sock.connected = false
    api.post.mockRejectedValueOnce(new Error('network down'))
    await emitHeartbeat(100_000, deps)
    await emitHeartbeat(101_000, deps)
    expect(api.post).toHaveBeenCalledTimes(2)
  })
})
