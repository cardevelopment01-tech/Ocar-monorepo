import { describe, it, expect } from 'vitest'
import { createGlider, lerp, type Positionable } from '../marker-glide'

// A manual clock and a manual animation loop, so a test decides when each frame runs.
function rig() {
  let t = 0
  const queue: Array<() => void> = []
  const glider = createGlider(1000, {
    now: () => t,
    raf: (cb) => { queue.push(cb); return queue.length },
    cancel: () => { queue.length = 0 },
  })
  return {
    glider,
    advance: (ms: number) => { t += ms },
    frame: () => { const cb = queue.shift(); cb?.() },
    pending: () => queue.length,
  }
}
const marker = (): Positionable & { position?: { lat: number; lng: number } } => ({})

describe('lerp', () => {
  it('interpolates and clamps', () => {
    expect(lerp({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 0.5)).toEqual({ lat: 5, lng: 10 })
    expect(lerp({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, -1)).toEqual({ lat: 0, lng: 0 })
    expect(lerp({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 3)).toEqual({ lat: 10, lng: 20 })
  })
})

describe('createGlider', () => {
  it('places a marker on its first fix straight away, with no animation', () => {
    const { glider, pending } = rig()
    const m = marker()
    glider.moveTo('a', m, 20, 85)
    expect(m.position).toEqual({ lat: 20, lng: 85 })
    expect(pending()).toBe(0)
    expect(glider.running).toBe(false)
  })

  it('glides to a new fix over the duration and lands exactly on it', () => {
    const { glider, advance, frame } = rig()
    const m = marker()
    glider.moveTo('a', m, 20, 85)
    glider.moveTo('a', m, 21, 86)
    advance(500); frame()
    expect(m.position!.lat).toBeCloseTo(20.5, 6)
    expect(m.position!.lng).toBeCloseTo(85.5, 6)
    advance(600); frame()
    expect(m.position).toEqual({ lat: 21, lng: 86 })
  })

  it('stops its loop when nothing is moving', () => {
    const { glider, advance, frame, pending } = rig()
    const m = marker()
    glider.moveTo('a', m, 20, 85)
    glider.moveTo('a', m, 21, 86)
    expect(glider.running).toBe(true)
    advance(1500); frame()
    expect(pending()).toBe(0)
    expect(glider.running).toBe(false)
  })

  it('a new fix mid-glide starts from where the dot is, so it never jumps', () => {
    const { glider, advance, frame } = rig()
    const m = marker()
    glider.moveTo('a', m, 0, 0)
    glider.moveTo('a', m, 10, 0)
    advance(500); frame() // halfway: lat 5
    expect(m.position!.lat).toBeCloseTo(5, 6)
    glider.moveTo('a', m, 5, 10) // new fix while at lat 5
    advance(500); frame() // halfway to the new fix
    expect(m.position!.lat).toBeCloseTo(5, 6)
    expect(m.position!.lng).toBeCloseTo(5, 6)
  })

  it('moves every marker from one shared loop', () => {
    const { glider, advance, frame, pending } = rig()
    const ms = Array.from({ length: 50 }, marker)
    ms.forEach((m, i) => { glider.moveTo(`d${i}`, m, 20, 85); glider.moveTo(`d${i}`, m, 21, 86) })
    expect(pending()).toBe(1) // one frame request for all 50, not one each
    advance(500); frame()
    expect(ms.every((m) => Math.abs(m.position!.lat - 20.5) < 1e-6)).toBe(true)
  })

  it('ignores a repeat of the same fix', () => {
    const { glider, pending } = rig()
    const m = marker()
    glider.moveTo('a', m, 20, 85)
    glider.moveTo('a', m, 20, 85)
    expect(pending()).toBe(0)
  })

  it('a replaced marker is placed at once at the latest fix', () => {
    const { glider } = rig()
    const first = marker(), second = marker()
    glider.moveTo('a', first, 20, 85)
    glider.moveTo('a', second, 22, 87)
    expect(second.position).toEqual({ lat: 22, lng: 87 })
  })

  it('forgets removed markers and cleans up on dispose', () => {
    const { glider } = rig()
    const m = marker()
    glider.moveTo('a', m, 20, 85)
    glider.moveTo('a', m, 21, 86)
    glider.remove('a')
    expect(glider.size).toBe(0)
    glider.moveTo('b', marker(), 1, 1)
    glider.dispose()
    expect(glider.size).toBe(0)
    expect(glider.running).toBe(false)
  })
})
