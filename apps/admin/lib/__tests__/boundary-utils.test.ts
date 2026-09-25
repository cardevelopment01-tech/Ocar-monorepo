import { describe, it, expect } from 'vitest'
import { parsePastedPolygon, sameShape, boundaryWarnings } from '../boundary-utils'
import type { CityBoundaryAnalysis, CityBoundaryGeoJson } from '../boundary-api'

const SQUARE: CityBoundaryGeoJson = {
  type: 'Polygon',
  coordinates: [[[84, 21], [84.1, 21], [84.1, 21.1], [84, 21.1], [84, 21]]],
}

describe('parsePastedPolygon', () => {
  it('accepts a bare Polygon', () => {
    expect(parsePastedPolygon(JSON.stringify(SQUARE))).toEqual({ ok: true, polygon: SQUARE })
  })

  it('unwraps a Feature (what geojson.io / OSM exports emit)', () => {
    const r = parsePastedPolygon(JSON.stringify({ type: 'Feature', properties: {}, geometry: SQUARE }))
    expect(r).toEqual({ ok: true, polygon: SQUARE })
  })

  it('drops altitude ordinates so the contract stays [lng, lat]', () => {
    const withZ = { type: 'Polygon', coordinates: [[[84, 21, 5], [84.1, 21, 5], [84.1, 21.1, 5], [84, 21, 5]]] }
    const r = parsePastedPolygon(JSON.stringify(withZ))
    expect(r.ok && r.polygon.coordinates[0]).toEqual([[84, 21], [84.1, 21], [84.1, 21.1], [84, 21]])
  })

  it.each([
    ['not json', '{nope', 'Not valid JSON.'],
    ['an empty string', '', 'Not valid JSON.'],
    ['null', 'null', 'Must be a GeoJSON Polygon'],
    ['a Point', '{"type":"Point","coordinates":[84,21]}', 'Must be a GeoJSON Polygon'],
    ['a MultiPolygon', '{"type":"MultiPolygon","coordinates":[]}', 'Must be a GeoJSON Polygon'],
    ['a Feature with no geometry', '{"type":"Feature"}', 'Must be a GeoJSON Polygon'],
    ['missing coordinates', '{"type":"Polygon"}', 'Must be a GeoJSON Polygon'],
  ])('rejects %s', (_label, input, message) => {
    const r = parsePastedPolygon(input)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain(message)
  })

  it('rejects holes / multiple rings (one outline per city)', () => {
    const ring = SQUARE.coordinates[0]
    const r = parsePastedPolygon(JSON.stringify({ type: 'Polygon', coordinates: [ring, ring] }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/single outline/)
  })

  it.each([
    ['fewer than 3 positions', [[84, 21], [84.1, 21]]],
    ['non-numeric coordinates', [[84, 'x'], [84.1, 21], [84.1, 21.1]]],
    ['null coordinates', [[84, null], [84.1, 21], [84.1, 21.1]]],
    ['a ring that is not an array', 'nope'],
  ])('rejects a ring with %s', (_label, ring) => {
    const r = parsePastedPolygon(JSON.stringify({ type: 'Polygon', coordinates: [ring] }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/at least 3/)
  })
})

describe('sameShape', () => {
  it('treats null/null as unchanged and null/shape as changed', () => {
    expect(sameShape(null, null)).toBe(true)
    expect(sameShape(SQUARE, null)).toBe(false)
    expect(sameShape(null, SQUARE)).toBe(false)
  })

  it('compares coordinates by value, not by reference', () => {
    const clone: CityBoundaryGeoJson = JSON.parse(JSON.stringify(SQUARE))
    expect(sameShape(SQUARE, clone)).toBe(true)
  })

  it('ignores sub-centimetre rounding differences between the draw library and PostGIS', () => {
    const rounded: CityBoundaryGeoJson = JSON.parse(JSON.stringify(SQUARE))
    rounded.coordinates[0]![1] = [84.1 + 1e-9, 21 - 1e-9]
    expect(sameShape(SQUARE, rounded)).toBe(true)
  })

  it('detects a moved vertex and a different vertex count', () => {
    const moved: CityBoundaryGeoJson = JSON.parse(JSON.stringify(SQUARE))
    moved.coordinates[0]![1] = [84.1, 21.0001]
    expect(sameShape(SQUARE, moved)).toBe(false)
    const shorter: CityBoundaryGeoJson = { type: 'Polygon', coordinates: [SQUARE.coordinates[0]!.slice(0, 4)] }
    expect(sameShape(SQUARE, shorter)).toBe(false)
  })
})

describe('boundaryWarnings', () => {
  const base: CityBoundaryAnalysis = {
    isValid: true, invalidReason: null, vertexCount: 5, areaKm2: 12,
    bboxKm: { widthKm: 3, heightKm: 4 }, centroidInside: true, overlaps: [],
  }

  it('is empty for null, invalid, and clean analyses', () => {
    expect(boundaryWarnings(null)).toEqual([])
    const invalid = { ...base, isValid: false, invalidReason: 'Self-intersection', overlaps: [{ cityId: 1, name: 'X', pctOfNew: 50 }] }
    expect(boundaryWarnings(invalid)).toEqual([])
    expect(boundaryWarnings(base)).toEqual([])
    expect(boundaryWarnings({ ...base, centroidInside: null })).toEqual([])
  })

  it('lists each overlap and a centroid-outside warning', () => {
    const w = boundaryWarnings({
      ...base,
      centroidInside: false,
      overlaps: [{ cityId: 1, name: 'Bhubaneswar', pctOfNew: 100 }, { cityId: 2, name: 'Cuttack', pctOfNew: 40.5 }],
    })
    expect(w).toEqual([
      'Overlaps Bhubaneswar (100%)',
      'Overlaps Cuttack (40.5%)',
      "This city's own centroid falls outside the shape",
    ])
  })
})
