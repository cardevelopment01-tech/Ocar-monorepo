import { NOTIFICATION_READ_RETENTION_DAYS, NOTIFICATION_UNREAD_RETENTION_DAYS } from '@/constants/limits'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'notification-purge-processor' })

// Deletes stale notification_logs rows past their retention window. Read
// items (or delivery-tracking rows for non-in_app channels, which never
// have read_at set) age out sooner than unread ones — an owner who hasn't
// opened the app yet still deserves the item to be there when they do.
export async function processPurgeOldNotifications(): Promise<void> {
  // Dynamic import: see partition-purge.processor.ts for why (avoids a
  // top-level @/config import crashing unrelated Vitest suites).
  const { pool } = await import('@/db/client')

  const res = await pool.query(
    `DELETE FROM notification_logs
     WHERE (read_at IS NOT NULL AND created_at < now() - ($1 || ' days')::interval)
        OR (read_at IS NULL     AND created_at < now() - ($2 || ' days')::interval)`,
    [NOTIFICATION_READ_RETENTION_DAYS, NOTIFICATION_UNREAD_RETENTION_DAYS]
  )
  log.info({ deleted: res.rowCount ?? 0 }, 'purged old notification_logs rows')
}
