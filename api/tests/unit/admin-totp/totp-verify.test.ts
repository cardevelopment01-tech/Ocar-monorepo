import { describe, it, expect } from 'vitest'
import { generateSecret, generate, verify } from 'otplib'

// Validates the exact otplib usage this module relies on (generate/verify
// with epochTolerance for clock-drift), independent of the DB-backed service.
describe('otplib TOTP generate/verify', () => {
  const secret = generateSecret()
  const EPOCH_TOLERANCE_SECONDS = 30
  const baseEpoch = 1_700_000_000

  it('accepts the correct code for the current time step', async () => {
    const token = await generate({ secret, epoch: baseEpoch })
    const result = await verify({ secret, token, epoch: baseEpoch, epochTolerance: EPOCH_TOLERANCE_SECONDS })
    expect(result.valid).toBe(true)
  })

  it('accepts a code from one step of clock drift within tolerance', async () => {
    const token = await generate({ secret, epoch: baseEpoch })
    // Verifying 25s later — still within the same or adjacent 30s step.
    const result = await verify({ secret, token, epoch: baseEpoch + 25, epochTolerance: EPOCH_TOLERANCE_SECONDS })
    expect(result.valid).toBe(true)
  })

  it('rejects a code far outside the tolerance window', async () => {
    const token = await generate({ secret, epoch: baseEpoch })
    const result = await verify({ secret, token, epoch: baseEpoch + 600, epochTolerance: EPOCH_TOLERANCE_SECONDS })
    expect(result.valid).toBe(false)
  })

  it('rejects a garbage code', async () => {
    const result = await verify({ secret, token: '000000', epoch: baseEpoch, epochTolerance: EPOCH_TOLERANCE_SECONDS })
    expect(result.valid).toBe(false)
  })

  it('rejects a code generated with a different secret', async () => {
    const otherSecret = generateSecret()
    const token = await generate({ secret: otherSecret, epoch: baseEpoch })
    const result = await verify({ secret, token, epoch: baseEpoch, epochTolerance: EPOCH_TOLERANCE_SECONDS })
    expect(result.valid).toBe(false)
  })

  // Regression: otplib throws for a non-6-digit token (e.g. a recovery code
  // like "MYF8-XNW8") instead of returning { valid: false } — verifyLoginCode
  // must never pass one straight through to verify().
  it('throws (does not return invalid) for a non-6-digit token', async () => {
    await expect(verify({ secret, token: 'MYF8-XNW8', epoch: baseEpoch, epochTolerance: EPOCH_TOLERANCE_SECONDS }))
      .rejects.toThrow()
  })

  it('rejects a code from a time step at or before afterTimeStep (replay guard)', async () => {
    const token = await generate({ secret, epoch: baseEpoch })
    const first = await verify({ secret, token, epoch: baseEpoch, epochTolerance: EPOCH_TOLERANCE_SECONDS })
    expect(first.valid).toBe(true)
    if (!first.valid) return

    // Replaying the exact same code/time-step must now be rejected.
    const replay = await verify({
      secret, token, epoch: baseEpoch, epochTolerance: EPOCH_TOLERANCE_SECONDS,
      afterTimeStep: first.timeStep,
    })
    expect(replay.valid).toBe(false)
  })
})
