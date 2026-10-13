import { describe, expect, it, vi } from 'vitest'
import type { Socket } from 'socket.io-client'
import { attachRoomJoin } from './useRoomJoin'

function fakeSocket() {
  const listeners: Record<string, (() => void)[]> = {}
  return {
    emit: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      ;(listeners[event] ??= []).push(cb)
    }),
    off: vi.fn((event: string, cb: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((l) => l !== cb)
    }),
    fireConnect: () => listeners['connect']?.forEach((cb) => cb()),
  } as unknown as Socket & { fireConnect: () => void }
}

describe('attachRoomJoin', () => {
  it('joins immediately and re-joins on every connect event (covers reconnect-after-background)', () => {
    const socket = fakeSocket()
    const onRejoined = vi.fn()
    attachRoomJoin(socket, 'ride-1', onRejoined)

    expect(socket.emit).toHaveBeenCalledWith('join:ride', 'ride-1')
    expect(onRejoined).toHaveBeenCalledTimes(1)

    socket.fireConnect()
    socket.fireConnect()

    expect(socket.emit).toHaveBeenCalledTimes(3)
    expect(onRejoined).toHaveBeenCalledTimes(3)
  })

  it('the returned cleanup unsubscribes the connect listener', () => {
    const socket = fakeSocket()
    const cleanup = attachRoomJoin(socket, 'ride-1')
    cleanup()
    socket.fireConnect()
    expect(socket.emit).toHaveBeenCalledTimes(2) // initial join + leave:ride, no re-join after cleanup
  })

  it('skipInitialRejoin only calls onRejoined on reconnect', () => {
    const socket = fakeSocket()
    const onRejoined = vi.fn()
    attachRoomJoin(socket, 'ride-1', onRejoined, { skipInitialRejoin: true })
    expect(socket.emit).toHaveBeenCalledWith('join:ride', 'ride-1')
    expect(onRejoined).not.toHaveBeenCalled()
    socket.fireConnect()
    expect(onRejoined).toHaveBeenCalledTimes(1)
  })

  it('emits leave:ride only when the last watcher of a ride detaches', () => {
    const socket = fakeSocket()
    const a = attachRoomJoin(socket, 'ride-1')
    const b = attachRoomJoin(socket, 'ride-1')
    a()
    expect(socket.emit).not.toHaveBeenCalledWith('leave:ride', 'ride-1')
    b()
    expect(socket.emit).toHaveBeenCalledWith('leave:ride', 'ride-1')
  })

  it('works without an onRejoined callback', () => {
    const socket = fakeSocket()
    expect(() => attachRoomJoin(socket, 'ride-1')).not.toThrow()
  })
})
