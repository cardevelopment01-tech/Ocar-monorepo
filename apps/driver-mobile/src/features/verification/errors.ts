// How the verification screen understands a refused submission. Pure (no React, no network) so it is unit tested.
// The server only ever sends retake reasons (how to fix a photo) and a tries-left count: never scores or match results.

export type VerificationFailure =
  | { kind: 'retake'; selfie: string | null; plate: string | null }
  | { kind: 'failed'; attemptsLeft: number }
  | { kind: 'under_review' }

type AxiosLike = {
  isAxiosError?: boolean
  response?: { data?: { code?: string; details?: { selfie?: string | null; plate?: string | null; attemptsLeft?: number } } }
}

export function parseVerificationFailure(err: unknown): VerificationFailure | null {
  const e = err as AxiosLike | null
  if (!e?.isAxiosError) return null
  const data = e.response?.data
  const d = data?.details
  switch (data?.code) {
    case 'VERIFICATION_RETAKE': {
      const selfie = d?.selfie ?? null
      const plate = d?.plate ?? null
      return selfie || plate ? { kind: 'retake', selfie, plate } : null
    }
    case 'VERIFICATION_FAILED':
      return { kind: 'failed', attemptsLeft: typeof d?.attemptsLeft === 'number' ? d.attemptsLeft : 0 }
    case 'VERIFICATION_UNDER_REVIEW':
      return { kind: 'under_review' }
    default:
      return null
  }
}

// One short instruction line per retake reason, shown on the step that needs redoing (design review DD2).
const RETAKE_LINES: Record<string, string> = {
  NO_FACE: 'Show your full face',
  MULTIPLE_FACES: 'Only you should be in the photo',
  POOR_QUALITY: 'Move to better light',
  FACE_ANGLE: 'Look straight at the camera',
  NO_PLATE_TEXT: 'Keep the whole plate in the frame',
}

export function retakeLine(reason: string | null | undefined): string {
  return (reason && RETAKE_LINES[reason]) || 'Please retake this photo'
}

export type Step = 'selfie' | 'plate'

// Which step to reopen first, and whether only that one photo needs redoing (the other is kept).
export function retakePlan(f: { selfie: string | null; plate: string | null }): { first: Step; only: Step | null } {
  if (f.selfie && f.plate) return { first: 'selfie', only: null }
  return f.selfie ? { first: 'selfie', only: 'selfie' } : { first: 'plate', only: 'plate' }
}
