import { describe, expect, it } from 'vitest'
import { INITIAL_RECENTER, nextRecenter, type RecenterInput } from './recenter'

// Value: protects=the driver's home map always ends up showing the driver (the reported "blank map, no car when I go online");
// fails_when=the first camera move is lost because the native map was not ready, or going online does not bring the
// camera back, or a driver who pans is dragged back on every GPS tick; why_new=driver home map re-centering;
// seam=none (pure rules); no_claim=the native camera animation.
const FIX: [number, number] = [20.35, 85.9] // outside the default region
const LIVE: [number, number] = [20.351, 85.901]
const base: RecenterInput = { mapReady: true, position: FIX, livePosition: null, isOnline: false }

describe('nextRecenter', () => {
  it('does nothing until the native map is ready, and does not lose the move: it happens once the map is ready', () => {
    const early = nextRecenter(INITIAL_RECENTER, { ...base, mapReady: false })
    expect(early.target).toBeNull()
    const ready = nextRecenter(early.state, base)
    expect(ready.target).toEqual(FIX)
  })

  it('moves to the first position once, then leaves the camera alone (a driver who pans is not dragged back)', () => {
    const first = nextRecenter(INITIAL_RECENTER, base)
    expect(first.target).toEqual(FIX)
    const again = nextRecenter(first.state, { ...base, position: [20.36, 85.91] })
    expect(again.target).toBeNull()
  })

  it('waits for a position: map ready but no fix yet moves nothing, and the later fix moves the camera', () => {
    const none = nextRecenter(INITIAL_RECENTER, { ...base, position: null })
    expect(none.target).toBeNull()
    expect(nextRecenter(none.state, base).target).toEqual(FIX)
  })

  it('going online brings the camera to the live position once, even after the first fix was handled', () => {
    const afterFix = nextRecenter(INITIAL_RECENTER, base)
    const online = nextRecenter(afterFix.state, { ...base, isOnline: true, livePosition: LIVE })
    expect(online.target).toEqual(LIVE)
    const tick = nextRecenter(online.state, { ...base, isOnline: true, livePosition: [20.352, 85.902] })
    expect(tick.target).toBeNull() // GPS ticks never re-centre
  })

  it('online but live GPS not there yet: no move until it arrives', () => {
    const afterFix = nextRecenter(INITIAL_RECENTER, base)
    const waiting = nextRecenter(afterFix.state, { ...base, isOnline: true, livePosition: null })
    expect(waiting.target).toBeNull()
    expect(nextRecenter(waiting.state, { ...base, isOnline: true, livePosition: LIVE }).target).toEqual(LIVE)
  })

  it('a new online session after going offline moves the camera again', () => {
    let s = nextRecenter(INITIAL_RECENTER, base).state
    s = nextRecenter(s, { ...base, isOnline: true, livePosition: LIVE }).state
    s = nextRecenter(s, { ...base, isOnline: false }).state // offline
    expect(nextRecenter(s, { ...base, isOnline: true, livePosition: LIVE }).target).toEqual(LIVE)
  })
})
