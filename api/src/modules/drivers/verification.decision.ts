// Pure scoring rules for the daily selfie and plate check. No I/O: thresholds come in as a plain object so the same
// functions serve every mode. See docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md section 8.

export interface Thresholds {
  facePassMin: number
  faceReviewMin: number
  minBrightness: number
  minSharpness: number
  plateMaxEdits: number
  plateReviewEdits: number
}

export type Decision = 'pass' | 'review' | 'fail' | 'retake'
export interface DecisionResult { decision: Decision; reason: string }

export interface FaceInput {
  faceCount: number
  quality: { brightness: number; sharpness: number; yaw: number; pitch: number } | null
  bestSimilarity: number | null
}

const MAX_YAW = 35
const MAX_PITCH = 30

export function decideFace(i: FaceInput, t: Thresholds): DecisionResult {
  if (i.faceCount === 0) return { decision: 'retake', reason: 'NO_FACE' }
  if (i.faceCount > 1) return { decision: 'retake', reason: 'MULTIPLE_FACES' }
  const q = i.quality
  if (!q) return { decision: 'retake', reason: 'POOR_QUALITY' }
  if (q.brightness < t.minBrightness || q.sharpness < t.minSharpness) return { decision: 'retake', reason: 'POOR_QUALITY' }
  if (Math.abs(q.yaw) > MAX_YAW || Math.abs(q.pitch) > MAX_PITCH) return { decision: 'retake', reason: 'FACE_ANGLE' }
  const s = i.bestSimilarity ?? 0
  if (s >= t.facePassMin) return { decision: 'pass', reason: 'MATCH' }
  if (s >= t.faceReviewMin) return { decision: 'review', reason: 'BORDERLINE_MATCH' }
  return { decision: 'fail', reason: 'LOW_SIMILARITY' }
}

// OCR confuses these pairs constantly, so both sides are folded to one character before comparing.
const CONFUSABLE: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', B: '8', S: '5', Z: '2' }

export function normalizePlate(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function fold(s: string): string {
  let out = ''
  for (const c of s) out += CONFUSABLE[c] ?? c
  return out
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

// Standard series (OD33AW5615, OD02A1234) and the Bharat series (22BH1234AA).
const PLATE_RE = /[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2}/g

export interface PlateDecisionResult extends DecisionResult { text: string | null }

export function decidePlate(lines: { text: string }[], registered: string, t: Thresholds): PlateDecisionResult {
  const joined = normalizePlate(lines.map((l) => l.text).join(''))
  const candidates = joined.match(PLATE_RE) ?? []
  if (candidates.length === 0) return { decision: 'retake', reason: 'NO_PLATE_TEXT', text: null }
  const target = fold(normalizePlate(registered))
  let best = candidates[0]!
  let bestDist = Infinity
  for (const c of candidates) {
    const d = levenshtein(fold(c), target)
    if (d < bestDist) { best = c; bestDist = d }
  }
  if (bestDist <= t.plateMaxEdits) return { decision: 'pass', reason: 'PLATE_MATCH', text: best }
  if (bestDist <= t.plateReviewEdits) return { decision: 'review', reason: 'PLATE_NEAR_MATCH', text: best }
  return { decision: 'fail', reason: 'PLATE_MISMATCH', text: best }
}
