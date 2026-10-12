import { describe, it, expect, vi, beforeEach } from 'vitest'

// A synchronous throw inside a Socket.IO listener is an uncaught exception that kills the whole process, so every
// client-controlled payload must be survivable. These drive the real handlers registered by initSocketServer.
const { ServerCtor, connectionHandlers } = vi.hoisted(() => {
  const connectionHandlers: Array<(socket: unknown) => void> = []
  return {
    connectionHandlers,
    ServerCtor: vi.fn().mockImplementation(() => ({
      adapter: vi.fn(),
      use: vi.fn(),
      on: vi.fn((event: string, cb: (s: unknown) => void) => { if (event === 'connection') connectionHandlers.push(cb) }),
    })),
  }
})
vi.mock('socket.io', () => ({ Server: ServerCtor }))
vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: vi.fn() }))
vi.mock('@/lib/jwt', () => ({ verifyAccessToken: vi.fn() }))
vi.mock('@/config', () => ({ config: { ALLOWED_ORIGINS: 'http://localhost:3000' } }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { duplicate: vi.fn(() => ({})), del: vi.fn().mockResolvedValue(1) } }))
vi.mock('@/modules/rides/rides.repository', () => ({ getPendingAssignmentsForDriver: vi.fn().mockResolvedValue([]) }))
vi.mock('@/modules/rides/rides.service', () => ({ updateLocation: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/middleware/auth.middleware', () => ({ isDriverSessionReplaced: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/logger', () => ({
  logger: { child: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })), warn: vi.fn() },
}))

import { pool } from '@/db/client'
import { updateLocation } from '@/modules/rides/rides.service'
import { initSocketServer } from '@/websocket/socket.server'

type Handler = (...args: unknown[]) => unknown

function connect(role: 'driver' | 'user') {
  const handlers = new Map<string, Handler>()
  const socket = {
    id: 's1',
    data: { user: { sub: '9', role } } as Record<string, unknown>,
    on: vi.fn((event: string, cb: Handler) => { handlers.set(event, cb) }),
    join: vi.fn(),
    leave: vi.fn(),
    emit: vi.fn(),
  }
  connectionHandlers[connectionHandlers.length - 1]!(socket)
  return { socket, handlers }
}

describe('socket handlers survive hostile payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connectionHandlers.length = 0
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never)
    initSocketServer({} as never)
  })

  const garbage: unknown[] = [undefined, null, 0, '', 'abc', '1; DROP TABLE rides', {}, [], { rideId: {} }, 'x'.repeat(5000), 1e30, NaN]

  it.each(['join:ride', 'leave:ride', 'chat:open', 'ride:request:ack', 'location:update'])(
    '%s never throws, whatever the payload',
    (event) => {
      const { handlers } = connect('driver')
      const handler = handlers.get(event)
      expect(handler, `${event} must be registered for a driver`).toBeTypeOf('function')
      for (const payload of garbage) expect(() => handler!(payload)).not.toThrow()
    }
  )

  it('join:ride with a real id checks the ride and joins the room', () => {
    const { socket, handlers } = connect('user')
    handlers.get('join:ride')!('123')
    expect(socket.join).toHaveBeenCalledWith('ride:123')
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM rides'), [123n])
  })

  it('join:ride with a non-id never touches the database or joins a room', () => {
    const { socket, handlers } = connect('user')
    handlers.get('join:ride')!('12; DROP TABLE rides')
    expect(socket.join).not.toHaveBeenCalledWith(expect.stringContaining('ride:'))
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('FROM rides'), expect.anything())
  })

  it('location:update with a valid payload reaches updateLocation with parsed values', () => {
    const { handlers } = connect('driver')
    const recordedAt = new Date().toISOString()
    handlers.get('location:update')!({ sessionId: '5', lat: 20.3, lng: 85.8, heading: 90, speed: 40, recordedAt })
    expect(updateLocation).toHaveBeenCalledWith(9n, { sessionId: 5n, lat: 20.3, lng: 85.8, heading: 90, speed: 40, recordedAt })
  })

  it('location:update with a wrong device clock is FORWARDED (updateLocation substitutes server time), not silently dropped', () => {
    const { handlers } = connect('driver')
    handlers.get('location:update')!({ sessionId: '5', lat: 20.3, lng: 85.8, recordedAt: '2001-01-01T00:00:00Z' })
    expect(updateLocation).toHaveBeenCalledWith(9n, expect.objectContaining({ sessionId: 5n, recordedAt: '2001-01-01T00:00:00Z' }))
  })

  it('location:update with an oversized timestamp string is replaced by server time, never forwarded', () => {
    const { handlers } = connect('driver')
    handlers.get('location:update')!({ sessionId: '5', lat: 20.3, lng: 85.8, recordedAt: 'x'.repeat(5000) })
    const sent = vi.mocked(updateLocation).mock.calls[0]![1].recordedAt
    expect(sent.length).toBeLessThan(40)
    expect(Math.abs(Date.parse(sent) - Date.now())).toBeLessThan(5_000)
  })

  it('location:update with no timestamp at all is stamped with server time', () => {
    const { handlers } = connect('driver')
    handlers.get('location:update')!({ sessionId: '5', lat: 20.3, lng: 85.8 })
    const sent = vi.mocked(updateLocation).mock.calls[0]![1].recordedAt
    expect(Math.abs(Date.parse(sent) - Date.now())).toBeLessThan(5_000)
  })

  it.each([
    ['latitude out of range', { lat: 123 }],
    ['non-numeric longitude', { lng: '85.8' }],
    ['bad session id', { sessionId: 'abc' }],
  ])('location:update with %s is dropped before updateLocation', (_n, patch) => {
    const { handlers } = connect('driver')
    handlers.get('location:update')!({ sessionId: '5', lat: 20.3, lng: 85.8, recordedAt: new Date().toISOString(), ...patch })
    expect(updateLocation).not.toHaveBeenCalled()
  })
})
