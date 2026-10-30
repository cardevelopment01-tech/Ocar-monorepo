import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({ S3_ACCESS_KEY: '', S3_SECRET_KEY: '' }))
vi.mock('@/config', () => ({ config: cfg }))

import { awsCredentials } from '@/lib/aws-credentials'

describe('awsCredentials', () => {
  beforeEach(() => { cfg.S3_ACCESS_KEY = ''; cfg.S3_SECRET_KEY = '' })

  it('returns nothing when no keys are set, so the SDK uses the instance role', () => {
    expect(awsCredentials()).toEqual({})
  })
  it('returns the static keys when both are set', () => {
    cfg.S3_ACCESS_KEY = 'k'; cfg.S3_SECRET_KEY = 's'
    expect(awsCredentials()).toEqual({ credentials: { accessKeyId: 'k', secretAccessKey: 's' } })
  })
  it('returns nothing when only one is set (config validation rejects that case at boot)', () => {
    cfg.S3_ACCESS_KEY = 'k'
    expect(awsCredentials()).toEqual({})
  })
})
