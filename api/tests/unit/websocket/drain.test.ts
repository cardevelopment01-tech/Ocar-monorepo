import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Server } from 'socket.io'
import { startDrain, isDraining, resetDrainForTests } from '@/websocket/drain'

interface FakeSocket {
  id: string
  conn: { close: ReturnType<typeof vi.fn> }
  disconnect: ReturnType<typeof vi.fn>
}

function fakeSocket(i: number, onClose?: () => void): FakeSocket {
  return { id: `s${i}`, conn: { close: vi.fn(() => onClose?.()) }, disconnect: vi.fn() }
}

function fakeIo(sockets: FakeSocket[]) {
  const handlers: Record<string, (s: FakeSocket) => void> = {}
  const io = {
    of: () => ({ sockets: new Map(sockets.map((s) => [s.id, s])) }),
    on: (event: string, fn: (s: FakeSocket) => void) => {
      handlers[event] = fn
    },
  }
  return { io: io as unknown as Server, handlers }
}

describe('startDrain', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetDrainForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes every socket exactly once, over the whole duration, at the transport (never socket.disconnect)', async () => {
    const sockets = Array.from({ length: 300 }, (_, i) => fakeSocket(i))
    const { io } = fakeIo(sockets)

    const drain = startDrain(io, 90_000, 'test')
    expect(drain.total).toBe(300)
    expect(isDraining()).toBe(true)

    await vi.advanceTimersByTimeAsync(89_000)
    const closedBefore = sockets.filter((s) => s.conn.close.mock.calls.length > 0).length
    expect(closedBefore).toBeGreaterThan(250) // spread, not all at the end

    await vi.advanceTimersByTimeAsync(2_000)
    await drain.done
    for (const s of sockets) {
      expect(s.conn.close).toHaveBeenCalledTimes(1)
      // socket.disconnect() makes the client report "io server disconnect" and NOT reconnect: never use it
      expect(s.disconnect).not.toHaveBeenCalled()
    }
  })

  it('never closes more than about twice the average rate in any second (no herd)', async () => {
    const times: number[] = []
    const sockets = Array.from({ length: 900 }, (_, i) => fakeSocket(i, () => times.push(Date.now())))
    const { io } = fakeIo(sockets)

    const drain = startDrain(io, 90_000, 'test') // average 10 per second
    await vi.advanceTimersByTimeAsync(91_000)
    await drain.done

    expect(times).toHaveLength(900)
    const perSecond = new Map<number, number>()
    for (const t of times) perSecond.set(Math.floor(t / 1000), (perSecond.get(Math.floor(t / 1000)) ?? 0) + 1)
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(2 * 10 + 2)
  })

  it('closes in a different order than the sockets connected (random, so no pattern in who reconnects first)', async () => {
    const order: number[] = []
    const sockets = Array.from({ length: 200 }, (_, i) => fakeSocket(i, () => order.push(i)))
    const { io } = fakeIo(sockets)

    const drain = startDrain(io, 20_000, 'test')
    await vi.advanceTimersByTimeAsync(21_000)
    await drain.done

    expect([...order].sort((a, b) => a - b)).toEqual(sockets.map((_, i) => i))
    expect(order).not.toEqual(sockets.map((_, i) => i))
  })

  it('is idempotent: a second call returns the drain already in progress and closes nothing twice', async () => {
    const sockets = Array.from({ length: 20 }, (_, i) => fakeSocket(i))
    const { io } = fakeIo(sockets)

    const first = startDrain(io, 10_000, 'first')
    const second = startDrain(io, 10_000, 'second')
    expect(second).toBe(first)

    await vi.advanceTimersByTimeAsync(11_000)
    await first.done
    for (const s of sockets) expect(s.conn.close).toHaveBeenCalledTimes(1)
  })

  it('closes a client that connects while the drain runs (recovery skips middlewares) within 5 s', async () => {
    const { io, handlers } = fakeIo([fakeSocket(0)])
    const drain = startDrain(io, 10_000, 'test')

    const late = fakeSocket(99)
    handlers['connection']!(late)
    await vi.advanceTimersByTimeAsync(5_001)
    expect(late.conn.close).toHaveBeenCalledTimes(1)
    expect(late.disconnect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6_000)
    await drain.done
  })

  it('finishes at once when nobody is connected', async () => {
    const { io } = fakeIo([])
    const drain = startDrain(io, 90_000, 'test')
    expect(drain.total).toBe(0)
    await expect(drain.done).resolves.toBeUndefined()
  })

  it('keeps going when closing one socket throws', async () => {
    const bad = fakeSocket(0)
    bad.conn.close.mockImplementation(() => {
      throw new Error('already closed')
    })
    const good = fakeSocket(1)
    const { io } = fakeIo([bad, good])

    const drain = startDrain(io, 1_000, 'test')
    await vi.advanceTimersByTimeAsync(1_500)
    await drain.done
    expect(good.conn.close).toHaveBeenCalledTimes(1)
  })
})
