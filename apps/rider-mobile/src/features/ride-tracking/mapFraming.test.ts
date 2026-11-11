import { describe, expect, it } from 'vitest'
import { MIN_VISIBLE_FRACTION, SHEET_BREATHING_PX, framePoints, framingPadding, isInVisibleBand, sheetHeightBucket } from './mapFraming'

// Value: protects=the rider's live map never frames the car under the bottom sheet (the reported "only the pickup pin, no
// car"); fails_when=the camera padding ignores the sheet or the in-view check counts the covered strip as visible;
// why_new=tracking-map fix; seam=none (pure maths); no_claim=how the native map draws or animates.
const base = { top: 80, right: 60, bottom: 80, left: 60 }

describe('framingPadding', () => {
  it('keeps the default padding when no sheet has been measured', () => {
    expect(framingPadding(base, 0, 800)).toEqual(base)
    expect(framingPadding(base, Number.NaN, 800)).toEqual(base)
  })

  it('raises the bottom padding above the sheet, with breathing room, and leaves the other sides alone', () => {
    // The reported phone: ~800 px map, sheet ~480 px (60%) -> the car must clear it, not sit under it.
    const p = framingPadding(base, 480, 800)
    expect(p.bottom).toBe(480 + SHEET_BREATHING_PX)
    expect([p.top, p.right, p.left]).toEqual([80, 60, 60])
  })

  it('never lowers the padding below the default for a short sheet', () => {
    expect(framingPadding(base, 20, 800).bottom).toBe(80)
  })

  it('leaves a usable band when the sheet is very tall', () => {
    const p = framingPadding(base, 760, 800)
    expect(800 - p.top - p.bottom).toBeGreaterThanOrEqual(800 * MIN_VISIBLE_FRACTION - 1)
  })

  it('does not collapse when the map height is not known yet', () => {
    expect(framingPadding(base, 480, 0).bottom).toBe(480 + SHEET_BREATHING_PX)
  })
})

describe('isInVisibleBand', () => {
  const map = { width: 400, height: 800 }
  it('a point in the open part of the map is visible', () => {
    expect(isInVisibleBand({ x: 200, y: 200 }, map, 480)).toBe(true)
  })
  it('a point under the sheet is not, although it is inside the map', () => {
    expect(isInVisibleBand({ x: 200, y: 700 }, map, 480)).toBe(false)
    expect(isInVisibleBand({ x: 200, y: 700 }, map, 0)).toBe(true) // the old, sheet-blind check
  })
  it('a point off the map is not visible', () => {
    expect(isInVisibleBand({ x: -5, y: 100 }, map, 480)).toBe(false)
    expect(isInVisibleBand({ x: 200, y: 900 }, map, 0)).toBe(false)
  })
})

describe('sheetHeightBucket', () => {
  it('ignores small layout jitter and notices a real resize', () => {
    expect(sheetHeightBucket(480)).toBe(sheetHeightBucket(486))
    expect(sheetHeightBucket(480)).not.toBe(sheetHeightBucket(300))
    expect(sheetHeightBucket(-10)).toBe(0)
  })
})

describe('framePoints', () => {
  const pickup: [number, number] = [20.2961, 85.8245]
  const drop: [number, number] = [20.4625, 85.883]
  const driver: [number, number] = [20.3, 85.83]
  const car: [number, number] = [20.298, 85.826]
  const base = { pickup, stops: [] as [number, number][], drop, showDrop: true, driverPos: null, cars: [] as [number, number][], frameDrop: true }

  it('searching with cars near: frames the pickup and the cars, not the far drop', () => {
    expect(framePoints({ ...base, cars: [car] })).toEqual([pickup, car])
  })
  it('a driver on the way: frames the pickup and the driver, not the far drop', () => {
    expect(framePoints({ ...base, driverPos: driver, frameDrop: false })).toEqual([pickup, driver])
  })
  it('the trip under way (or nothing near): frames the whole trip including stops, drop and driver', () => {
    const stop: [number, number] = [20.35, 85.85]
    expect(framePoints({ ...base, stops: [stop], driverPos: driver })).toEqual([pickup, stop, drop, driver])
    expect(framePoints(base)).toEqual([pickup, drop])
    expect(framePoints({ ...base, showDrop: false })).toEqual([pickup])
  })
  it('an assigned driver wins over any leftover nearby cars', () => {
    expect(framePoints({ ...base, driverPos: driver, cars: [car], frameDrop: false })).toEqual([pickup, driver])
  })
})
