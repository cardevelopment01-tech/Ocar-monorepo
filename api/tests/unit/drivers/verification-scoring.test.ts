import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn(),
  promotePendingUpload: vi.fn(),
  // Same shape as the real helper: only S3 URLs have a key.
  extractS3Key: (url: string) => url.match(/^https:\/\/[^./]+\.s3\.[^./]+\.amazonaws\.com\/(.+)$/)?.[1] ?? null,
}))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn(async (_k: string, fallback: string) => fallback) }))
vi.mock('@/modules/drivers/verification.provider', () => ({
  detectFaces: vi.fn(),
  compareFaces: vi.fn(),
  detectText: vi.fn(),
}))
vi.mock('@/modules/drivers/drivers.repository', () => ({ findVehicleByDriverId: vi.fn() }))
vi.mock('@/modules/drivers/driver-verification.repository', () => ({}))

import * as provider from '@/modules/drivers/verification.provider'
import { getConfigValue } from '@/lib/system-config'
import {
  loadThresholds, resolveMode, scorePlate, scoreSelfie, scoreSubmission,
} from '@/modules/drivers/driver-verification.service'

const detectFaces = vi.mocked(provider.detectFaces)
const compareFaces = vi.mocked(provider.compareFaces)
const detectText = vi.mocked(provider.detectText)
const cfg = vi.mocked(getConfigValue)

const SELFIE = 'https://b.s3.ap-south-1.amazonaws.com/drivers/1/daily-verification/selfie/new.jpg'
const REF = 'https://b.s3.ap-south-1.amazonaws.com/drivers/1/profile/ref.jpg'
const PLATE = 'https://b.s3.ap-south-1.amazonaws.com/drivers/1/daily-verification/plate/new.jpg'
const GOOD_Q = { brightness: 70, sharpness: 70, yaw: 0, pitch: 0 }
const T = { facePassMin: 90, faceReviewMin: 75, minBrightness: 35, minSharpness: 35, plateMaxEdits: 1, plateReviewEdits: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  cfg.mockImplementation(async (_k: string, fallback: string) => fallback)
})

describe('resolveMode', () => {
  it('is off by default and for any unknown value', async () => {
    expect(await resolveMode(null)).toBe('off')
    expect(await resolveMode('nonsense')).toBe('off')
  })
  it('passes flag and block through', async () => {
    expect(await resolveMode('flag')).toBe('flag')
    expect(await resolveMode('block')).toBe('block')
  })
  it('a driver override beats the global switch in both directions', async () => {
    cfg.mockResolvedValue('shadow')
    expect(await resolveMode(null)).toBe('shadow')
    expect(await resolveMode('off')).toBe('off')
    cfg.mockResolvedValue('off')
    expect(await resolveMode('shadow')).toBe('shadow')
  })
})

describe('loadThresholds', () => {
  it('uses configured numbers', async () => {
    cfg.mockImplementation(async (k: string, f: string) => (k === 'verification_face_pass_min' ? '95' : f))
    expect((await loadThresholds()).facePassMin).toBe(95)
  })
  it('falls back to the defaults when the review line is not below the pass line', async () => {
    cfg.mockImplementation(async (k: string, f: string) => (k === 'verification_face_review_min' ? '95' : f))
    expect(await loadThresholds()).toMatchObject({ facePassMin: 90, faceReviewMin: 75 })
  })
  it('falls back per value when a setting is not a number', async () => {
    cfg.mockImplementation(async (k: string, f: string) => (k === 'verification_min_brightness' ? 'abc' : f))
    expect((await loadThresholds()).minBrightness).toBe(35)
  })
})

describe('scoreSelfie', () => {
  it('passes a clear match and asks Rekognition with a floor under the review band', async () => {
    detectFaces.mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
    compareFaces.mockResolvedValue(96)
    const r = await scoreSelfie(SELFIE, REF, T)
    expect(r).toMatchObject({ decision: 'pass', reason: 'MATCH', similarity: 96 })
    expect(compareFaces).toHaveBeenCalledWith('drivers/1/profile/ref.jpg', 'drivers/1/daily-verification/selfie/new.jpg', 65)
  })

  it('tries admin-confirmed references only when the first result is not conclusive, and keeps the best', async () => {
    const X1 = 'https://b.s3.ap-south-1.amazonaws.com/drivers/1/refs/a.jpg'
    const X2 = 'https://b.s3.ap-south-1.amazonaws.com/drivers/1/refs/b.jpg'
    detectFaces.mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
    compareFaces.mockResolvedValueOnce(80).mockResolvedValueOnce(93).mockResolvedValueOnce(70)
    const r = await scoreSelfie(SELFIE, REF, T, [X1, X2])
    expect(r).toMatchObject({ decision: 'pass', similarity: 93 })
    expect(compareFaces).toHaveBeenCalledTimes(3)

    compareFaces.mockClear()
    compareFaces.mockResolvedValueOnce(96)
    await scoreSelfie(SELFIE, REF, T, [X1, X2])
    expect(compareFaces).toHaveBeenCalledTimes(1) // already conclusive: no extra Rekognition calls
  })

  it('does not compare when the photo needs a retake', async () => {
    detectFaces.mockResolvedValue({ faceCount: 0, quality: null })
    const r = await scoreSelfie(SELFIE, REF, T)
    expect(r).toMatchObject({ decision: 'retake', reason: 'NO_FACE' })
    expect(compareFaces).not.toHaveBeenCalled()
  })

  it('records no match as a fail with null similarity', async () => {
    detectFaces.mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
    compareFaces.mockResolvedValue(null)
    expect(await scoreSelfie(SELFIE, REF, T)).toMatchObject({ decision: 'fail', similarity: null })
  })

  it('skips (not fails) when the driver has no usable reference', async () => {
    detectFaces.mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
    expect(await scoreSelfie(SELFIE, null, T)).toMatchObject({ decision: 'skipped', reason: 'NO_REFERENCE' })
    expect(await scoreSelfie(SELFIE, 'https://elsewhere.test/ref.jpg', T)).toMatchObject({ decision: 'skipped', reason: 'NO_REFERENCE' })
    compareFaces.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'InvalidParameterException' }))
    expect(await scoreSelfie(SELFIE, REF, T)).toMatchObject({ decision: 'skipped', reason: 'REFERENCE_UNUSABLE' })
    compareFaces.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'InvalidS3ObjectException' }))
    expect(await scoreSelfie(SELFIE, REF, T)).toMatchObject({ decision: 'skipped', reason: 'REFERENCE_MISSING' })
  })

  it('skips a photo that is not an S3 object (dev placeholder URL)', async () => {
    expect(await scoreSelfie('https://placeholder.test/x.jpg', REF, T)).toMatchObject({ decision: 'skipped', reason: 'NOT_S3' })
    expect(detectFaces).not.toHaveBeenCalled()
  })

  it('lets other provider errors propagate to the caller', async () => {
    detectFaces.mockRejectedValue(new Error('boom'))
    await expect(scoreSelfie(SELFIE, REF, T)).rejects.toThrow('boom')
  })
})

describe('scorePlate', () => {
  it('passes a matching read and records the text and mean confidence', async () => {
    detectText.mockResolvedValue([{ text: 'OD33', confidence: 90 }, { text: 'AW5615', confidence: 80 }])
    expect(await scorePlate(PLATE, 'OD33AW5615', T)).toMatchObject({
      decision: 'pass', ocrText: 'OD33AW5615', ocrConfidence: 85,
    })
  })
  it('skips when the vehicle has no registered plate', async () => {
    expect(await scorePlate(PLATE, null, T)).toMatchObject({ decision: 'skipped', reason: 'NO_REGISTERED_PLATE' })
  })
  it('has no confidence when nothing was read', async () => {
    detectText.mockResolvedValue([])
    expect(await scorePlate(PLATE, 'OD33AW5615', T)).toMatchObject({ decision: 'retake', ocrConfidence: null })
  })
})

describe('scoreSubmission', () => {
  const args = { mode: 'shadow' as const, selfieUrl: SELFIE, plateUrl: PLATE, referenceUrl: REF, registeredPlate: 'OD33AW5615' }

  afterEach(() => { vi.useRealTimers() })

  it('scores both photos and records the thresholds used', async () => {
    detectFaces.mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
    compareFaces.mockResolvedValue(95)
    detectText.mockResolvedValue([{ text: 'OD33AW5615', confidence: 99 }])
    const r = await scoreSubmission(args)
    expect(r.mode).toBe('shadow')
    expect(r.selfie.decision).toBe('pass')
    expect(r.plate.decision).toBe('pass')
    expect(r.thresholds).toMatchObject({ facePassMin: 90 })
  })

  it('turns a provider error on one photo into an error row without losing the other', async () => {
    detectFaces.mockRejectedValue(new Error('boom'))
    detectText.mockResolvedValue([{ text: 'OD33AW5615', confidence: 99 }])
    const r = await scoreSubmission(args)
    expect(r.selfie).toMatchObject({ decision: 'error', reason: 'PROVIDER_ERROR' })
    expect(r.plate.decision).toBe('pass')
  })

  it('gives up after the overall timeout and reports TIMEOUT for both', async () => {
    vi.useFakeTimers()
    detectFaces.mockReturnValue(new Promise(() => {}))
    detectText.mockReturnValue(new Promise(() => {}))
    const pending = scoreSubmission(args)
    await vi.advanceTimersByTimeAsync(4001)
    const r = await pending
    expect(r.selfie).toMatchObject({ decision: 'error', reason: 'TIMEOUT' })
    expect(r.plate).toMatchObject({ decision: 'error', reason: 'TIMEOUT' })
  })
})
