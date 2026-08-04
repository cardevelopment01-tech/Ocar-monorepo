import { describe, it, expect, vi } from 'vitest'

const { ServerCtor } = vi.hoisted(() => ({
  ServerCtor: vi.fn().mockImplementation(() => ({
    adapter: vi.fn(),
    use: vi.fn(),
    on: vi.fn(),
  })),
}))
vi.mock('socket.io', () => ({ Server: ServerCtor }))
vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: vi.fn() }))
vi.mock('@/lib/jwt', () => ({ verifyAccessToken: vi.fn() }))
vi.mock('@/config', () => ({ config: { ALLOWED_ORIGINS: 'http://localhost:3000' } }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { duplicate: vi.fn(() => ({})) } }))
vi.mock('@/modules/rides/rides.repository', () => ({ getPendingAssignmentsForDriver: vi.fn() }))
vi.mock('@/modules/rides/rides.service', () => ({ updateLocation: vi.fn() }))

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
})
