import { describe, it, expect } from 'vitest'
import { selectPartitionsToPurge } from '@/jobs/processors/partition-purge.processor'

describe('selectPartitionsToPurge', () => {
  it('selects only partitions fully older than the retention window', () => {
    const now = new Date('2026-07-17T00:00:00Z')
    const names = ['gps_tracks_2026_07', 'gps_tracks_2026_01', 'gps_tracks_2025_06']
    const result = selectPartitionsToPurge(names, now, 90)
    expect(result).toEqual(['gps_tracks_2026_01', 'gps_tracks_2025_06'])
  })

  it('purges nothing when every partition is within the retention window', () => {
    const now = new Date('2026-07-17T00:00:00Z')
    const result = selectPartitionsToPurge(['gps_tracks_2026_07', 'gps_tracks_2026_06'], now, 90)
    expect(result).toEqual([])
  })

  it('ignores table names that are not gps_tracks partitions', () => {
    const now = new Date('2026-07-17T00:00:00Z')
    const result = selectPartitionsToPurge(['gps_tracks_2020_01', 'unrelated_table'], now, 90)
    expect(result).toEqual(['gps_tracks_2020_01'])
  })
})
