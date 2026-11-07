// What a scored decision does to a stored row, per mode. Pure: no I/O. Design doc section 8.3.
import type { CheckDecision } from './driver-verification.repository'

export type VerificationMode = 'shadow' | 'flag' | 'block'
export type RowStatus = 'passed' | 'auto_passed' | 'failed'
export type CheckKind = 'selfie' | 'plate'

export interface RowOutcome {
  status: RowStatus
  reviewState: 'none' | 'queued'
  priority: number // higher = an admin looks first
}

const QUIET: RowOutcome = { status: 'auto_passed', reviewState: 'none', priority: 0 }

export function rowOutcome(kind: CheckKind, mode: VerificationMode, decision: CheckDecision): RowOutcome {
  if (mode === 'shadow') return QUIET
  switch (decision) {
    case 'pass': return { status: 'passed', reviewState: 'none', priority: 0 }
    case 'skipped': return QUIET
    // Could not score (outage): let the driver through, but a person should still look, last.
    case 'error': return { status: 'auto_passed', reviewState: 'queued', priority: 0 }
    // 'retake' only reaches a row once the daily retake limit is used up: an admin decides.
    case 'review':
    case 'retake': return { status: 'auto_passed', reviewState: 'queued', priority: 1 }
    case 'fail': {
      // Only a selfie mismatch (the account-sharing signal) may block; plate OCR is the least reliable part, so a
      // plate fail always goes to review and never stops a driver by itself.
      const blocks = mode === 'block' && kind === 'selfie'
      return { status: blocks ? 'failed' : 'auto_passed', reviewState: 'queued', priority: 2 }
    }
  }
}

export interface RetakeRequest { selfie: string | null; plate: string | null }

// Which photos must be retaken before anything is stored. Never in shadow (nothing a driver sees may change), and
// never once a photo has used up its retakes for the day (then it simply goes to review).
export function pendingRetake(
  mode: VerificationMode,
  checks: { selfie: { decision: CheckDecision; reason: string }; plate: { decision: CheckDecision; reason: string } },
  priorRetakes: { selfie: number; plate: number },
  retakeMax: number
): RetakeRequest | null {
  if (mode === 'shadow') return null
  const need = (kind: CheckKind): string | null =>
    checks[kind].decision === 'retake' && priorRetakes[kind] < retakeMax ? checks[kind].reason : null
  const r = { selfie: need('selfie'), plate: need('plate') }
  return r.selfie || r.plate ? r : null
}
