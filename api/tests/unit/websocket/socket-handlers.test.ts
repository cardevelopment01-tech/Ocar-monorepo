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
vi.mock('@socket.io/redis-streams-adapter', () => ({ createAdapter: vi.fn() }))
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
import { roomsAround } from '@/websocket/nearby-cells'

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

// A searching rider listens to the map cells around THEIR pickup. They never name coordinates, so the feed cannot be pointed
// at an area they are not in, or kept after the ride is no longer searching.
describe('nearby:subscribe (live cars for a searching rider)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connectionHandlers.length = 0
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never)
    initSocketServer({} as never)
  })

  const subscribe = (handlers: Map<string, Handler>, payload: unknown) => { handlers.get('nearby:subscribe')!(payload) }
  const PICKUP = { lat: 20.2961, lng: 85.8245 }
  // The socket also joins its private user: room on connect; only the nearby cells matter here.
  const nearbyJoins = (socket: { join: unknown }) => vi.mocked(socket.join as never as (r: string) => void).mock.calls.map((c) => c[0] as string).filter((r) => r.startsWith('nearby:'))

  it('is only offered to riders: a driver cannot subscribe to the cars around anywhere', () => {
    const { handlers } = connect('driver')
    expect(handlers.has('nearby:subscribe')).toBe(false)
    expect(handlers.has('nearby:unsubscribe')).toBe(false)
  })

  it('reads the pickup from the rider\'s OWN searching ride and joins the 25 cells around it', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [PICKUP] } as never)
    const { socket, handlers } = connect('user')
    subscribe(handlers, { rideId: '55' })
    await vi.waitFor(() => expect(nearbyJoins(socket)).toHaveLength(25))
    const [sql, args] = vi.mocked(pool.query).mock.calls[0]!
    expect(String(sql)).toContain('user_id = $2')
    expect(String(sql)).toContain("status = 'requested'")
    expect(args).toEqual([55n, 9n]) // the ride, and the socket's own user id -- never one the client supplied
    expect(nearbyJoins(socket).sort()).toEqual(roomsAround(PICKUP.lat, PICKUP.lng).sort())
  })

  it('joins nothing for a ride that is not theirs or is no longer searching (the query finds no row)', async () => {
    const { socket, handlers } = connect('user')
    subscribe(handlers, { rideId: '55' })
    await vi.waitFor(() => expect(pool.query).toHaveBeenCalled())
    await Promise.resolve()
    expect(nearbyJoins(socket)).toEqual([])
  })

  it('leaves the cells it listened to once the ride is no longer searching, and on unsubscribe', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [PICKUP] } as never)
    const { socket, handlers } = connect('user')
    subscribe(handlers, { rideId: '55' })
    await vi.waitFor(() => expect(nearbyJoins(socket)).toHaveLength(25))
    subscribe(handlers, { rideId: '55' }) // asked again after it was accepted: no row now
    await vi.waitFor(() => expect(socket.leave).toHaveBeenCalledTimes(25))

    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [PICKUP] } as never)
    subscribe(handlers, { rideId: '56' })
    await vi.waitFor(() => expect(nearbyJoins(socket)).toHaveLength(25))
    handlers.get('nearby:unsubscribe')!()
    expect(socket.leave).toHaveBeenCalledTimes(25)
  })

  it('moving the pickup leaves the cells it no longer covers and joins the new ones', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [PICKUP] } as never)
    const { socket, handlers } = connect('user')
    subscribe(handlers, { rideId: '55' })
    await vi.waitFor(() => expect(nearbyJoins(socket)).toHaveLength(25))
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ lat: PICKUP.lat + 0.04, lng: PICKUP.lng }] } as never) // two cells north
    subscribe(handlers, { rideId: '55' })
    await vi.waitFor(() => expect(socket.leave).toHaveBeenCalled())
    const before = new Set(roomsAround(PICKUP.lat, PICKUP.lng))
    const after = new Set(roomsAround(PICKUP.lat + 0.04, PICKUP.lng))
    const left = vi.mocked(socket.leave).mock.calls.map((c) => c[0] as string)
    expect(left.every((r) => before.has(r) && !after.has(r))).toBe(true)
    expect(left).toHaveLength([...before].filter((r) => !after.has(r)).length)
  })

  it('an unsubscribe that arrives while the subscribe lookup is still in flight wins: nothing is joined afterwards', async () => {
    let finish!: (v: unknown) => void
    vi.mocked(pool.query).mockReturnValueOnce(new Promise((r) => { finish = r }) as never)
    const { socket, handlers } = connect('user')
    subscribe(handlers, { rideId: '55' })
    handlers.get('nearby:unsubscribe')!() // the rider left before the database answered
    finish({ rows: [PICKUP] })
    await new Promise((r) => setTimeout(r, 10))
    expect(nearbyJoins(socket)).toEqual([])
  })

  it('a second subscribe supersedes one still in flight (only the latest answer joins rooms)', async () => {
    let first!: (v: unknown) => void
    vi.mocked(pool.query)
      .mockReturnValueOnce(new Promise((r) => { first = r }) as never)
      .mockResolvedValueOnce({ rows: [{ lat: PICKUP.lat + 0.04, lng: PICKUP.lng }] } as never)
    const { socket, handlers } = connect('user')
    subscribe(handlers, { rideId: '55' })
    subscribe(handlers, { rideId: '56' })
    await vi.waitFor(() => expect(nearbyJoins(socket)).toHaveLength(25))
    first({ rows: [PICKUP] }) // the slow, older answer arrives last and must be ignored
    await new Promise((r) => setTimeout(r, 10))
    expect(nearbyJoins(socket).sort()).toEqual(roomsAround(PICKUP.lat + 0.04, PICKUP.lng).sort())
  })

  it('re-checks the ride while subscribed and leaves the cells once it stops searching (a client that never unsubscribes)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [PICKUP] } as never) // the subscribe
      const { socket, handlers } = connect('user')
      subscribe(handlers, { rideId: '55' })
      await vi.waitFor(() => expect(nearbyJoins(socket)).toHaveLength(25))
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [PICKUP] } as never) // first recheck: still searching
      await vi.advanceTimersByTimeAsync(20_100)
      expect(socket.leave).not.toHaveBeenCalled()
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never) // second recheck: a driver was assigned
      await vi.advanceTimersByTimeAsync(20_100)
      expect(socket.leave).toHaveBeenCalledTimes(25)
      vi.mocked(pool.query).mockClear()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(pool.query).not.toHaveBeenCalled() // and it stops checking
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers at most 12 subscribe requests a minute per socket (a reconnect loop or a scraper is cut off)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [PICKUP] } as never)
    const { handlers } = connect('user')
    for (let i = 0; i < 20; i++) subscribe(handlers, { rideId: '55' })
    await vi.waitFor(() => expect(pool.query).toHaveBeenCalledTimes(12))
    await new Promise((r) => setTimeout(r, 10))
    expect(pool.query).toHaveBeenCalledTimes(12)
  })

  it.each([undefined, null, 0, '', 'abc', '1; DROP TABLE rides', {}, [], { rideId: {} }, { rideId: 'x'.repeat(5000) }, { rideId: 1e30 }, { rideId: NaN }])(
    'never throws or touches the database for a hostile payload: %j',
    (payload) => {
      const { handlers } = connect('user')
      expect(() => subscribe(handlers, payload)).not.toThrow()
      expect(() => handlers.get('nearby:unsubscribe')!(payload)).not.toThrow()
      expect(pool.query).not.toHaveBeenCalled()
    }
  )
})
