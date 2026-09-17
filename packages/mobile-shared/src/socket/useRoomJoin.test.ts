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
    expect(socket.emit).toHaveBeenCalledTimes(1) // only the initial join, not after cleanup
  })

  it('works without an onRejoined callback', () => {
    const socket = fakeSocket()
    expect(() => attachRoomJoin(socket, 'ride-1')).not.toThrow()
  })
})
