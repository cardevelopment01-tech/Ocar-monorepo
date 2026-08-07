import { describe, it, expect, vi } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn().mockResolvedValue({ rowCount: 3 }) } }))

import { pool } from '@/db/client'
import { processPurgeOldNotifications } from '@/jobs/processors/notification-purge.processor'
import { NOTIFICATION_READ_RETENTION_DAYS, NOTIFICATION_UNREAD_RETENTION_DAYS } from '@/constants/limits'

describe('processPurgeOldNotifications', () => {
  it('deletes past-retention notification_logs rows using the read/unread retention windows', async () => {
    await processPurgeOldNotifications()

    expect(vi.mocked(pool.query).mock.calls[0]![1]).toEqual([
      NOTIFICATION_READ_RETENTION_DAYS,
      NOTIFICATION_UNREAD_RETENTION_DAYS,
    ])
    expect(String(vi.mocked(pool.query).mock.calls[0]![0])).toContain('DELETE FROM notification_logs')
  })
})
