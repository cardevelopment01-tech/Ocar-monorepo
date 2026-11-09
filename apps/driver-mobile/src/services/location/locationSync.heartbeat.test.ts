import { describe, it, expect, vi, beforeEach } from 'vitest'

type Ack = (err: unknown, res?: { ok?: boolean; sessionActive?: boolean }) => void
const sock = vi.hoisted(() => ({
  connected: true,
  // what the fake server does with a heartbeat: 'ack' | 'silent' (half-dead connection) | 'timeout' (socket.io reports a timeout error)
  mode: 'ack' as 'ack' | 'silent' | 'timeout',
  emitted: [] as Array<{ event: string; payload: unknown }>,
  sessionActive: true,
}))
const socket = {
  get connected() { return sock.connected },
  timeout: () => ({
    emit: (event: string, payload: unknown, cb: Ack) => {
      sock.emitted.push({ event, payload })
      if (sock.mode === 'ack') cb(null, { ok: true, sessionActive: sock.sessionActive })
      else if (sock.mode === 'timeout') cb(new Error('operation has timed out'))
    },
  }),
}
const api = vi.hoisted(() => ({ post: vi.fn() }))
const session = vi.hoisted(() => ({ sessionId: '9' as string | null }))
const disk = vi.hoisted(() => ({ id: null as string | null, cleared: 0 }))

vi.mock('@/store/useDriverSessionStore', () => ({ useDriverSessionStore: { getState: () => ({ ...session, setOffline: () => { session.sessionId = null; disk.cleared++ } }) } }))
vi.mock('./persistedSession', () => ({ readPersistedSessionId: async () => disk.id, clearPersistedSessionId: () => { disk.cleared++ } }))

import { emitHeartbeat, resetHeartbeatForTests } from './locationSync'

const deps = { socket, api } as unknown as Parameters<typeof emitHeartbeat>[1]

beforeEach(() => {
  vi.clearAllMocks()
  resetHeartbeatForTests()
  sock.connected = true; sock.mode = 'ack'; sock.emitted.length = 0; sock.sessionActive = true
  session.sessionId = '9'; disk.id = null; disk.cleared = 0
  api.post.mockResolvedValue({ data: { sessionActive: true } })
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

  it('a failed HTTP heartbeat is retried after a short back-off, not after the full interval (a short network blip)', async () => {
    sock.connected = false
    api.post.mockRejectedValueOnce(new Error('network down'))
    await emitHeartbeat(100_000, deps)
    await emitHeartbeat(103_000, deps)
    expect(api.post).toHaveBeenCalledTimes(2)
  })

  it('the server saying "no live session" over the socket makes the app forget its saved session id', async () => {
    sock.sessionActive = false
    await emitHeartbeat(100_000, deps)
    expect(disk.cleared).toBeGreaterThanOrEqual(1)
    expect(session.sessionId).toBeNull()
  })

  it('the same over HTTP', async () => {
    sock.connected = false
    api.post.mockResolvedValue({ data: { sessionActive: false } })
    await emitHeartbeat(100_000, deps)
    expect(disk.cleared).toBeGreaterThanOrEqual(1)
  })

  it('while the network stays down the retries back off (3 s, 6 s, 12 s ...) instead of firing on every task run', async () => {
    sock.connected = false
    api.post.mockRejectedValue(new Error('down'))
    await emitHeartbeat(100_000, deps)        // fails -> next try allowed at +3 s
    await emitHeartbeat(101_000, deps)        // too early
    await emitHeartbeat(103_000, deps)        // fails -> next at +6 s
    await emitHeartbeat(106_000, deps)        // too early
    await emitHeartbeat(109_000, deps)        // fails
    expect(api.post).toHaveBeenCalledTimes(3)
  })
})
