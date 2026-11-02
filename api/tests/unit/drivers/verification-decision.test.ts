import { describe, it, expect } from 'vitest'
import { decideFace, decidePlate, levenshtein, normalizePlate, type Thresholds } from '@/modules/drivers/verification.decision'

const T: Thresholds = {
  facePassMin: 90, faceReviewMin: 75, minBrightness: 35, minSharpness: 35, plateMaxEdits: 1, plateReviewEdits: 2,
}
const GOOD_Q = { brightness: 70, sharpness: 70, yaw: 0, pitch: 0 }

describe('decideFace', () => {
  const cases: [string, Parameters<typeof decideFace>[0], string, string][] = [
    ['no face', { faceCount: 0, quality: null, bestSimilarity: null }, 'retake', 'NO_FACE'],
    ['two faces', { faceCount: 2, quality: null, bestSimilarity: null }, 'retake', 'MULTIPLE_FACES'],
    ['dark photo', { faceCount: 1, quality: { ...GOOD_Q, brightness: 10 }, bestSimilarity: 99 }, 'retake', 'POOR_QUALITY'],
    ['blurry photo', { faceCount: 1, quality: { ...GOOD_Q, sharpness: 10 }, bestSimilarity: 99 }, 'retake', 'POOR_QUALITY'],
    ['one face but no quality data', { faceCount: 1, quality: null, bestSimilarity: 99 }, 'retake', 'POOR_QUALITY'],
    ['turned head', { faceCount: 1, quality: { ...GOOD_Q, yaw: 50 }, bestSimilarity: 99 }, 'retake', 'FACE_ANGLE'],
    ['tilted down', { faceCount: 1, quality: { ...GOOD_Q, pitch: -40 }, bestSimilarity: 99 }, 'retake', 'FACE_ANGLE'],
    ['exactly at the pass line', { faceCount: 1, quality: GOOD_Q, bestSimilarity: 90 }, 'pass', 'MATCH'],
    ['just under the pass line', { faceCount: 1, quality: GOOD_Q, bestSimilarity: 89.9 }, 'review', 'BORDERLINE_MATCH'],
    ['exactly at the review line', { faceCount: 1, quality: GOOD_Q, bestSimilarity: 75 }, 'review', 'BORDERLINE_MATCH'],
    ['just under the review line', { faceCount: 1, quality: GOOD_Q, bestSimilarity: 74.9 }, 'fail', 'LOW_SIMILARITY'],
    ['no match returned at all', { faceCount: 1, quality: GOOD_Q, bestSimilarity: null }, 'fail', 'LOW_SIMILARITY'],
  ]
  it.each(cases)('%s', (_name, input, decision, reason) => {
    expect(decideFace(input, T)).toEqual({ decision, reason })
  })

  it('checks quality before similarity so a bad photo is never called a mismatch', () => {
    expect(decideFace({ faceCount: 1, quality: { ...GOOD_Q, brightness: 1 }, bestSimilarity: 0 }, T).decision).toBe('retake')
  })
})

describe('plate helpers', () => {
  it('normalizes case, spaces and punctuation', () => {
    expect(normalizePlate('od 33-aw 5615')).toBe('OD33AW5615')
  })
  it('computes edit distance', () => {
    expect(levenshtein('', '')).toBe(0)
    expect(levenshtein('abc', 'abc')).toBe(0)
    expect(levenshtein('abc', 'abd')).toBe(1)
    expect(levenshtein('abc', '')).toBe(3)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
})

describe('decidePlate', () => {
  const lines = (...texts: string[]) => texts.map((text) => ({ text }))

  it('passes an exact read split across lines and spaces', () => {
    const r = decidePlate(lines('OD 33', 'AW 5615'), 'OD33AW5615', T)
    expect(r).toMatchObject({ decision: 'pass', reason: 'PLATE_MATCH', text: 'OD33AW5615' })
  })

  it('treats look-alike characters as the same (0 vs O, 1 vs I)', () => {
    expect(decidePlate(lines('OD33AW5615'), '0D33AW5615', T).decision).toBe('pass')
    expect(decidePlate(lines('OD02A1234'), 'OD02A1234'.replace('1', 'I'), T).decision).toBe('pass')
  })

  it('allows one wrong character, reviews two, fails more', () => {
    expect(decidePlate(lines('OD33AW5615'), 'OD33AW5616', T).decision).toBe('pass')
    expect(decidePlate(lines('OD33AW5615'), 'OD33AW5666', T).decision).toBe('review')
    expect(decidePlate(lines('OD33AW5615'), 'OD11AB7777', T)).toMatchObject({ decision: 'fail', reason: 'PLATE_MISMATCH' })
  })

  it('asks for a retake when no plate-shaped text is found', () => {
    expect(decidePlate(lines('MARUTI', 'SUZUKI'), 'OD33AW5615', T)).toEqual({
      decision: 'retake', reason: 'NO_PLATE_TEXT', text: null,
    })
    expect(decidePlate([], 'OD33AW5615', T).decision).toBe('retake')
  })

  it('recognises the Bharat series', () => {
    expect(decidePlate(lines('22 BH 1234 AA'), '22BH1234AA', T).decision).toBe('pass')
  })

  it('picks the closest of several plate-shaped candidates', () => {
    const r = decidePlate(lines('KA01AB1234', 'OD33AW5615'), 'OD33AW5615', T)
    expect(r).toMatchObject({ decision: 'pass', text: 'OD33AW5615' })
  })
})
