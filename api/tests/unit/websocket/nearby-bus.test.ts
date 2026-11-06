import { describe, it, expect, vi, beforeEach } from 'vitest'

// Value: protects=live car positions reach only this server's sockets for cells somebody here is watching, never through the
// adapter's shared stream, and a broken Redis or malformed message can never take the API down; fails_when=a position is
// published to the wrong cell, a non-cell room is subscribed, a bad message throws, or a disconnected Redis queues publishes;
// why_new=live nearby-cars push; seam=fake Redis client + fake socket.io server; no_claim=a real Redis round trip.
const { redisMock, subMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...a: unknown[]) => void>()
  const subMock = {
    handlers,
    on: vi.fn((ev: string, cb: (...a: unknown[]) => void) => { handlers.set(ev, cb); return subMock }),
    subscribe: vi.fn().mockResolvedValue(1),
    unsubscribe: vi.fn().mockResolvedValue(1),
  }
  const redisMock = { status: 'ready', publish: vi.fn().mockResolvedValue(1), duplicate: vi.fn(() => subMock) }
  return { redisMock, subMock }
})
vi.mock('@/db/redis', () => ({ client: redisMock }))
vi.mock('@/lib/logger', () => ({ logger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })) } }))

import { initNearbyBus, publishNearbyCar } from '@/websocket/nearby-bus'
import { roomOfPoint } from '@/websocket/nearby-cells'

const car = { id: 'abc123def456', lat: 20.3, lng: 85.8, heading: 90, categoryId: 2 }

describe('publishNearbyCar', () => {
  beforeEach(() => { vi.clearAllMocks(); redisMock.status = 'ready'; redisMock.publish.mockResolvedValue(1) })

  it('publishes the car as JSON on the channel of the cell it is in, and says it went out', () => {
    expect(publishNearbyCar(car)).toBe(true)
    expect(redisMock.publish).toHaveBeenCalledWith(roomOfPoint(20.3, 85.8), JSON.stringify(car))
  })

  it('skips the publish while Redis is not ready, instead of queueing every ping in memory', () => {
    redisMock.status = 'reconnecting'
    expect(publishNearbyCar(car)).toBe(false) // the caller must not count it
    expect(redisMock.publish).not.toHaveBeenCalled()
  })

  it('swallows a failed publish: one lost position must never surface as an error or an unhandled rejection', async () => {
    redisMock.publish.mockRejectedValue(new Error('boom'))
    expect(() => publishNearbyCar(car)).not.toThrow()
    await new Promise((r) => setTimeout(r, 0)) // would surface as an unhandled rejection if not caught
  })
})

describe('initNearbyBus', () => {
  let adapterHandlers: Map<string, (room: string) => void>
  let emitted: Array<[string, string, unknown]>
  let io: never

  beforeEach(() => {
    vi.clearAllMocks()
    subMock.handlers.clear()
    adapterHandlers = new Map()
    emitted = []
    io = {
      of: () => ({ adapter: { on: (ev: string, cb: (room: string) => void) => { adapterHandlers.set(ev, cb) } } }),
      local: { to: (room: string) => ({ emit: (ev: string, payload: unknown) => { emitted.push([room, ev, payload]) } }) },
    } as never
    initNearbyBus(io)
  })

  it('subscribes the cell channel when the first local socket joins a nearby room, and unsubscribes when the last leaves', () => {
    adapterHandlers.get('create-room')!('nearby:1015:4290')
    expect(subMock.subscribe).toHaveBeenCalledWith('nearby:1015:4290')
    adapterHandlers.get('delete-room')!('nearby:1015:4290')
    expect(subMock.unsubscribe).toHaveBeenCalledWith('nearby:1015:4290')
  })

  it('ignores every other room (ride, driver, admin and per-socket rooms)', () => {
    for (const room of ['ride:5', 'driver:9', 'admin:ops', 'Xk3-socket-id']) {
      adapterHandlers.get('create-room')!(room)
      adapterHandlers.get('delete-room')!(room)
    }
    expect(subMock.subscribe).not.toHaveBeenCalled()
    expect(subMock.unsubscribe).not.toHaveBeenCalled()
  })

  it('hands a published position to this server\'s sockets in that room only (io.local: not the adapter stream)', () => {
    subMock.handlers.get('message')!('nearby:1015:4290', JSON.stringify(car))
    expect(emitted).toEqual([['nearby:1015:4290', 'nearby:car', car]])
  })

  it('drops a malformed or foreign message without throwing', () => {
    const onMessage = subMock.handlers.get('message')!
    expect(() => onMessage('nearby:1:1', '{not json')).not.toThrow()
    expect(() => onMessage('ride:5', JSON.stringify(car))).not.toThrow()
    expect(emitted).toEqual([])
  })

  it('retries a subscribe that failed while the room is still wanted (the adapter announces a room only once)', async () => {
    vi.useFakeTimers()
    subMock.subscribe.mockRejectedValueOnce(new Error('blip')).mockResolvedValue(1)
    adapterHandlers.get('create-room')!('nearby:5:5')
    await vi.advanceTimersByTimeAsync(0)
    expect(subMock.subscribe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_100)
    expect(subMock.subscribe).toHaveBeenCalledTimes(2) // retried
    vi.useRealTimers()
  })

  it('does not retry a room that emptied meanwhile', async () => {
    vi.useFakeTimers()
    subMock.subscribe.mockRejectedValue(new Error('blip'))
    adapterHandlers.get('create-room')!('nearby:6:6')
    await vi.advanceTimersByTimeAsync(0)
    adapterHandlers.get('delete-room')!('nearby:6:6') // the last socket left
    await vi.advanceTimersByTimeAsync(30_000)
    expect(subMock.subscribe).toHaveBeenCalledTimes(1)
    subMock.subscribe.mockResolvedValue(1)
    vi.useRealTimers()
  })

  it('stops retrying after a few attempts instead of looping forever', async () => {
    vi.useFakeTimers()
    subMock.subscribe.mockRejectedValue(new Error('down'))
    adapterHandlers.get('create-room')!('nearby:7:7')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(subMock.subscribe.mock.calls.length).toBeLessThanOrEqual(5)
    subMock.subscribe.mockResolvedValue(1)
    vi.useRealTimers()
  })

  it('re-subscribes every wanted cell when the subscriber (re)connects, so channels always match rooms', () => {
    adapterHandlers.get('create-room')!('nearby:1:1')
    adapterHandlers.get('create-room')!('nearby:1:2')
    adapterHandlers.get('delete-room')!('nearby:1:2')
    subMock.subscribe.mockClear()
    subMock.handlers.get('ready')!()
    expect(subMock.subscribe.mock.calls.map((c) => c[0])).toEqual(['nearby:1:1'])
  })

  it('never throws at start-up, even if the server or Redis cannot be set up (live cars are optional)', () => {
    expect(() => initNearbyBus({} as never)).not.toThrow()
    redisMock.duplicate.mockImplementationOnce(() => { throw new Error('redis down') })
    expect(() => initNearbyBus(io)).not.toThrow()
  })
})
