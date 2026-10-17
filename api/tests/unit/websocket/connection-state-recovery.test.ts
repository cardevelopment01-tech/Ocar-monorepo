import { describe, it, expect, vi } from 'vitest'

const { ServerCtor } = vi.hoisted(() => ({
  ServerCtor: vi.fn().mockImplementation(() => ({
    adapter: vi.fn(),
    use: vi.fn(),
    on: vi.fn(),
  })),
}))
vi.mock('socket.io', () => ({ Server: ServerCtor }))
vi.mock('@socket.io/redis-streams-adapter', () => ({ createAdapter: vi.fn(() => 'streams-adapter') }))
vi.mock('@/lib/jwt', () => ({ verifyAccessToken: vi.fn() }))
vi.mock('@/config', () => ({ config: { ALLOWED_ORIGINS: 'http://localhost:3000' } }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { duplicate: vi.fn(() => ({})) } }))
vi.mock('@/modules/rides/rides.repository', () => ({ getPendingAssignmentsForDriver: vi.fn() }))
vi.mock('@/modules/rides/rides.service', () => ({ updateLocation: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { child: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })), warn: vi.fn() },
}))

import { initSocketServer } from '@/websocket/socket.server'

describe('initSocketServer', () => {
  it('enables connection state recovery so a brief disconnect (backgrounded app) replays buffered room events on reconnect', () => {
    initSocketServer({} as never)

    const options = ServerCtor.mock.calls[0]?.[1] as Record<string, unknown>
    expect(options.connectionStateRecovery).toEqual({
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    })
  })

  // Recovery is only honoured across instances by the Redis STREAMS adapter; the pub/sub adapter silently turns it into
  // a fresh session on whichever instance the client lands on (Socket.IO docs, "Compatibility with existing adapters").
  it('uses the Redis streams adapter, on its own duplicated connection, so a session can be recovered on another instance', async () => {
    const { createAdapter } = await import('@socket.io/redis-streams-adapter')
    vi.mocked(createAdapter).mockClear()
    initSocketServer({} as never)

    const io = ServerCtor.mock.results.at(-1)?.value as { adapter: ReturnType<typeof vi.fn> }
    expect(io.adapter).toHaveBeenCalledWith('streams-adapter')
    expect(createAdapter).toHaveBeenCalledTimes(1)
  })
})
