import { describe, expect, it } from 'vitest'
import { vehicleKindOf } from './vehicleKind'

// Value: protects=each vehicle category draws its own icon on the map (an auto rickshaw is not drawn as a car), including the
// 'auto' / 'auto_rickshaw' slug drift between environments; fails_when=a category falls back to the wrong icon;
// why_new=per-category map icons; seam=none (pure mapping); no_claim=how an icon looks.
describe('vehicleKindOf', () => {
  it.each([
    ['hatchback', 'hatchback'], ['sedan', 'sedan'], ['suv', 'suv'], ['luxury', 'luxury'], ['van', 'van'],
  ])('%s draws as %s', (slug, kind) => {
    expect(vehicleKindOf(slug)).toBe(kind)
  })
  it('both auto rickshaw slugs (live "auto", migration "auto_rickshaw") draw as an auto', () => {
    expect(vehicleKindOf('auto')).toBe('auto')
    expect(vehicleKindOf('auto_rickshaw')).toBe('auto')
  })
  it('an unknown, missing or empty slug draws as a sedan instead of nothing', () => {
    for (const s of ['tempo', '', null, undefined, 'constructor', '__proto__']) expect(vehicleKindOf(s as never)).toBe('sedan')
  })
})
