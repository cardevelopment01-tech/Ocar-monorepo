import { describe, it, expect } from 'vitest'
import { rowOutcome, pendingRetake } from '@/modules/drivers/verification.policy'

const q = (status: string, reviewState: string, priority: number) => ({ status, reviewState, priority })

describe('rowOutcome', () => {
  it('shadow never changes anything for any decision', () => {
    for (const d of ['pass', 'review', 'fail', 'retake', 'error', 'skipped'] as const) {
      expect(rowOutcome('selfie', 'shadow', d)).toEqual(q('auto_passed', 'none', 0))
    }
  })

  it('flag: pass is clean, review and fail queue but never block, errors queue last', () => {
    expect(rowOutcome('selfie', 'flag', 'pass')).toEqual(q('passed', 'none', 0))
    expect(rowOutcome('selfie', 'flag', 'review')).toEqual(q('auto_passed', 'queued', 1))
    expect(rowOutcome('selfie', 'flag', 'fail')).toEqual(q('auto_passed', 'queued', 2))
    expect(rowOutcome('selfie', 'flag', 'error')).toEqual(q('auto_passed', 'queued', 0))
    expect(rowOutcome('selfie', 'flag', 'skipped')).toEqual(q('auto_passed', 'none', 0))
  })

  it('a retake that reaches a row (limit used up) is reviewed', () => {
    expect(rowOutcome('plate', 'flag', 'retake')).toEqual(q('auto_passed', 'queued', 1))
  })

  it('block: only a selfie fail blocks; a plate fail goes to review', () => {
    expect(rowOutcome('selfie', 'block', 'fail')).toEqual(q('failed', 'queued', 2))
    expect(rowOutcome('plate', 'block', 'fail')).toEqual(q('auto_passed', 'queued', 2))
  })
})

describe('pendingRetake', () => {
  const ok = { decision: 'pass' as const, reason: 'MATCH' }
  const bad = (reason: string) => ({ decision: 'retake' as const, reason })
  const none = { selfie: 0, plate: 0 }

  it('asks for a retake of exactly the unusable photo', () => {
    expect(pendingRetake('flag', { selfie: bad('NO_FACE'), plate: ok }, none, 3)).toEqual({ selfie: 'NO_FACE', plate: null })
    expect(pendingRetake('flag', { selfie: ok, plate: bad('NO_PLATE_TEXT') }, none, 3)).toEqual({ selfie: null, plate: 'NO_PLATE_TEXT' })
    expect(pendingRetake('flag', { selfie: bad('POOR_QUALITY'), plate: bad('NO_PLATE_TEXT') }, none, 3))
      .toEqual({ selfie: 'POOR_QUALITY', plate: 'NO_PLATE_TEXT' })
  })

  it('is null when nothing needs a retake', () => {
    expect(pendingRetake('flag', { selfie: ok, plate: ok }, none, 3)).toBeNull()
  })

  it('never in shadow mode', () => {
    expect(pendingRetake('shadow', { selfie: bad('NO_FACE'), plate: ok }, none, 3)).toBeNull()
  })

  it('stops asking once that photo has used its retakes', () => {
    expect(pendingRetake('flag', { selfie: bad('NO_FACE'), plate: ok }, { selfie: 3, plate: 0 }, 3)).toBeNull()
    expect(pendingRetake('flag', { selfie: bad('NO_FACE'), plate: ok }, { selfie: 2, plate: 0 }, 3)).toEqual({ selfie: 'NO_FACE', plate: null })
  })
})
