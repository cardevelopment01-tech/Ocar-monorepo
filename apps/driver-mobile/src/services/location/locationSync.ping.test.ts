import { describe, it, expect, vi, beforeEach } from 'vitest'

// What the fake server does with a live ping: 'ack' | 'refuse' (acks ok:false) | 'silent' (half-dead connection: socket.io reports a timeout) | 'ended' (session over).
const sock = vi.hoisted(() => ({
  connected: true,
  mode: 'ack' as 'ack' | 'refuse' | 'silent' | 'ended',
  emitted: [] as Array<{ event: string; payload: unknown }>,
}))
type Ack = (err: unknown, res?: { ok?: boolean; sessionActive?: boolean }) => void
const socket = {
  get connected() { return sock.connected },
  timeout: () => ({
    emit: (event: string, payload: unknown, cb: Ack) => {
      sock.emitted.push({ event, payload })
      if (sock.mode === 'ack') cb(null, { ok: true, sessionActive: true })
      else if (sock.mode === 'ended') cb(null, { ok: true, sessionActive: false })
      else if (sock.mode === 'refuse') cb(null, { ok: false })
      else cb(new Error('operation has timed out'))
    },
  }),
}
const api = vi.hoisted(() => ({ post: vi.fn() }))
const session = vi.hoisted(() => ({ sessionId: '9' as string | null, offline: 0 }))
const disk = vi.hoisted(() => ({ cleared: 0 }))

vi.mock('@/store/useDriverSessionStore', () => ({ useDriverSessionStore: { getState: () => ({ sessionId: session.sessionId, setOffline: () => { session.offline++ } }) } }))
vi.mock('./persistedSession', () => ({ readPersistedSessionId: async () => null, clearPersistedSessionId: () => { disk.cleared++ } }))

import { emitLocationTick, resetLocationSyncForTests } from './locationSync'

const deps = { socket, api } as unknown as Parameters<typeof emitLocationTick>[1]
const fix = { lat: 20.3, lng: 85.8, recordedAt: '2026-11-25T10:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  resetLocationSyncForTests()
  sock.connected = true; sock.mode = 'ack'; sock.emitted.length = 0
  session.sessionId = '9'; session.offline = 0; disk.cleared = 0
  api.post.mockResolvedValue({ data: {} })
})

describe('live position ping', () => {
  it('goes over the socket and is acked: no HTTP call', async () => {
    await emitLocationTick(fix, deps)
    expect(sock.emitted).toEqual([{ event: 'location:update', payload: { sessionId: '9', ...fix } }])
    expect(api.post).not.toHaveBeenCalled()
  })

  it('a connected socket that never acks (half dead) sends the same fix over HTTP instead of losing it', async () => {
    sock.mode = 'silent'
    await emitLocationTick(fix, deps)
    expect(api.post).toHaveBeenCalledWith('/api/v1/rides/sessions/location', { sessionId: '9', ...fix })
  })

  it('a refused ping (ok:false) is retried over HTTP too', async () => {
    sock.mode = 'refuse'
    await emitLocationTick(fix, deps)
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('an ack that says the session ended makes the app forget it, with no HTTP resend', async () => {
    sock.mode = 'ended'
    await emitLocationTick(fix, deps)
    expect(session.offline).toBe(1)
    expect(disk.cleared).toBe(1)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('with no socket, waits out the short debounce before using HTTP (no flapping double-sends)', async () => {
    sock.connected = false
    await emitLocationTick(fix, deps)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('does nothing when the driver is not online', async () => {
    session.sessionId = null
    await emitLocationTick(fix, deps)
    expect(sock.emitted).toHaveLength(0)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('an HTTP 409 SESSION_ENDED makes the app forget the session instead of retrying it', async () => {
    sock.mode = 'silent'
    api.post.mockRejectedValue({ response: { status: 409, data: { code: 'SESSION_ENDED' } } })
    await emitLocationTick(fix, deps)
    expect(session.offline).toBe(1)
    expect(disk.cleared).toBe(1)
  })

  it('after an HTTP failure it backs off instead of stacking requests on every tick', async () => {
    sock.mode = 'silent'
    api.post.mockRejectedValue(new Error('network down'))
    await emitLocationTick(fix, deps)
    await emitLocationTick(fix, deps)
    expect(api.post).toHaveBeenCalledTimes(1)
  })
})
