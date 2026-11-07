import { describe, expect, it } from 'vitest'
import { OCAR_MAP_STYLE, ROUTE } from '../../../packages/mobile-shared/src/theme/mapStyle'
import { OCAR_LIGHT, ROUTE_LINE } from '../lib/trip-share/map-style'

// Value: protects=the public trip map looking like the rider app's map (one brand, one basemap); fails_when=someone retunes the
// app's style or route colours and the web page keeps the old copy; why_new=web copy of a mobile-only style; seam=none (pure
// data); no_claim=that Google renders it (checked by eye on the real map).
describe('trip page map style', () => {
  it('is the rider app\'s "Ocar Light" style, rule for rule', () => {
    expect(OCAR_LIGHT).toEqual(OCAR_MAP_STYLE)
  })
  it('draws the route in the same teal over white as the app', () => {
    expect(ROUTE_LINE).toEqual(ROUTE)
  })
})
