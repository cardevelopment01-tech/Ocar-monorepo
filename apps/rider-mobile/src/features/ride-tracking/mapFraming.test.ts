import { describe, expect, it } from 'vitest'
import { SHEET_BREATHING_PX, framingPadding, isInVisibleBand, sheetHeightBucket } from './mapFraming'

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
    expect(framingPadding(base, 40, 800).bottom).toBe(80)
  })

  it('leaves a usable band when the sheet is very tall', () => {
    const p = framingPadding(base, 760, 800)
    expect(800 - p.top - p.bottom).toBeGreaterThanOrEqual(800 * 0.2 - 1)
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
