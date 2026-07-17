import { describe, it, expect } from 'vitest'
import { getNextPartitionTarget } from '@/jobs/processors/partition-creator.processor'

describe('getNextPartitionTarget', () => {
  it('returns next month within the same year', () => {
    expect(getNextPartitionTarget(new Date('2026-07-17T00:00:00Z'))).toEqual({ year: 2026, month: 8 })
  })

  it('rolls over into January of the following year when called in December', () => {
    expect(getNextPartitionTarget(new Date('2026-12-15T00:00:00Z'))).toEqual({ year: 2027, month: 1 })
  })
})
