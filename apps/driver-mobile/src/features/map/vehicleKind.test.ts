import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MARKER_DP, vehicleKindOf, type VehicleKind } from './vehicleKind'

// Value: protects=each vehicle category draws its own map image (an auto rickshaw is not drawn as a car), and every image the map uses
// exists at every density with the size the marker expects; fails_when=a category falls back to the sedan, or an image file is missing
// or the wrong size (the marker would then be blank or scaled wrongly); why_new=the driver map drew one generic SVG car for everyone;
// seam=none (pure mapping plus file headers); no_claim=how an image looks.

const KINDS: VehicleKind[] = ['hatchback', 'sedan', 'suv', 'luxury', 'van', 'auto']
const dir = join(__dirname, '../../../assets/map')

describe('vehicleKindOf', () => {
  it.each([
    ['hatchback', 'hatchback'], ['sedan', 'sedan'], ['suv', 'suv'], ['luxury', 'luxury'], ['van', 'van'],
  ])('%s draws as %s', (slug, kind) => { expect(vehicleKindOf(slug)).toBe(kind) })

  it('both auto rickshaw slugs (live "auto", migration "auto_rickshaw") draw as an auto', () => {
    expect(vehicleKindOf('auto')).toBe('auto')
    expect(vehicleKindOf('auto_rickshaw')).toBe('auto')
  })

  it('an unknown, missing or inherited-property slug draws as a sedan', () => {
    expect(vehicleKindOf('bike')).toBe('sedan')
    expect(vehicleKindOf(null)).toBe('sedan')
    expect(vehicleKindOf(undefined)).toBe('sedan')
    expect(vehicleKindOf('')).toBe('sedan')
    expect(vehicleKindOf('toString')).toBe('sedan')
  })
})

// A WebP's pixel size is in its header: "RIFF....WEBP" then a VP8L chunk (lossless) whose width-1 and height-1 are packed in 14 bits each.
function webpSize(file: string): { w: number; h: number } {
  const b = readFileSync(file)
  expect(b.toString('ascii', 0, 4)).toBe('RIFF')
  expect(b.toString('ascii', 8, 12)).toBe('WEBP')
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 }
  throw new Error(`unexpected WebP chunk ${chunk} in ${file}`)
}

describe('vehicle map images', () => {
  it.each(KINDS.flatMap((k) => [1, 2, 3, 4].map((s) => [k, s] as const)))('%s at %ix exists and is the marker size times the scale', (kind, scale) => {
    const file = join(dir, scale === 1 ? `vehicle-${kind}.webp` : `vehicle-${kind}@${scale}x.webp`)
    expect(existsSync(file), file).toBe(true)
    expect(webpSize(file)).toEqual({ w: MARKER_DP[kind].w * scale, h: MARKER_DP[kind].h * scale })
  })
})
