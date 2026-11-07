// Pure helpers for the Verifications review page (no React, no network) so the rules are unit tested.
import type { VerificationDecision } from './verification-api'

export type Band = { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }

// The chip always carries text, never colour alone (accessibility item P4).
export function bandFor(decision: VerificationDecision | null): Band {
  switch (decision) {
    case 'pass': return { label: 'PASS', tone: 'success' }
    case 'review': return { label: 'REVIEW', tone: 'warning' }
    case 'fail': return { label: 'FAIL', tone: 'danger' }
    case 'retake': return { label: 'RETAKE LIMIT', tone: 'warning' }
    case 'error': return { label: 'NOT CHECKED', tone: 'muted' }
    default: return { label: 'N/A', tone: 'muted' }
  }
}

const REASONS: Record<string, string> = {
  LOW_SIMILARITY: "Face doesn't look like the registered photo",
  BORDERLINE_MATCH: 'Face is close to the registered photo, but not certain',
  PLATE_MISMATCH: "Number plate doesn't match the registered vehicle",
  PLATE_NEAR_MATCH: 'Number plate is nearly the registered one (one or two characters differ)',
  NO_PLATE_TEXT: 'No number plate could be read; the driver used up the retakes',
  NO_FACE: 'No face found; the driver used up the retakes',
  MULTIPLE_FACES: 'More than one face; the driver used up the retakes',
  POOR_QUALITY: 'Photo too dark or blurry; the driver used up the retakes',
  FACE_ANGLE: 'Face turned away; the driver used up the retakes',
  PROVIDER_ERROR: "The automatic check couldn't run, so a person should look",
  TIMEOUT: "The automatic check timed out, so a person should look",
}

export function reasonText(code: string | null): string {
  if (!code) return ''
  return REASONS[code] ?? code.replace(/_/g, ' ').toLowerCase()
}

export function kindLabel(kind: string): string {
  return kind.endsWith('plate') ? 'Plate' : 'Selfie'
}

export function similarityText(s: number | null): string {
  return s == null ? '-' : `${Math.round(s)}%`
}

export type ReviewKey = 'next' | 'prev' | 'ok' | 'mismatch' | null

// J/K move, O = looks fine, M = mismatch. Anything typed into a field, or with a modifier held, is not a shortcut.
export function reviewKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: EventTarget | { tagName?: string; isContentEditable?: boolean } | null }): ReviewKey {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null | undefined
  const tag = t?.tagName?.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return null
  switch (e.key.toLowerCase()) {
    case 'j': return 'next'
    case 'k': return 'prev'
    case 'o': return 'ok'
    case 'm': return 'mismatch'
    default: return null
  }
}

// After a case leaves the list, open the one now in its place (or the one before when it was last).
export function nextSelection(ids: string[], resolvedId: string): string | null {
  const i = ids.indexOf(resolvedId)
  if (i === -1) return ids[0] ?? null
  const rest = ids.filter((id) => id !== resolvedId)
  return rest[Math.min(i, rest.length - 1)] ?? null
}

export function budgetTone(waiting: number, budget: number): 'ok' | 'over' {
  return waiting > budget ? 'over' : 'ok'
}

// Why a driver was taken offline for a re-check, in the admin's words (the driver is never told the trigger).
export function challengeReasonText(reason: string): string {
  return reason === 'long_ride' ? 'After a long ride' : reason === 'rides' ? 'After a few rides' : 'Set by an admin'
}

export function waitingText(openedAt: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`
}
