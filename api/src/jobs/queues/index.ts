import { Queue } from 'bullmq'
import { config } from '@/config'

export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  GPS_FLUSH: 'gps-flush',
  SETTLEMENTS: 'settlements',
  ANALYTICS: 'analytics',
  SCHEDULER: 'scheduler',
  CLEANUP: 'cleanup',
} as const

function parseRedisUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url)
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
  }
}

const connection = parseRedisUrl(config.REDIS_URL)

export const notificationsQueue = new Queue(QUEUE_NAMES.NOTIFICATIONS, {
  connection,
})
export const gpsFlushQueue = new Queue(QUEUE_NAMES.GPS_FLUSH, { connection })
export const settlementsQueue = new Queue(QUEUE_NAMES.SETTLEMENTS, {
  connection,
})
export const analyticsQueue = new Queue(QUEUE_NAMES.ANALYTICS, { connection })
export const schedulerQueue = new Queue(QUEUE_NAMES.SCHEDULER, { connection })
export const cleanupQueue = new Queue(QUEUE_NAMES.CLEANUP, { connection })

export const queues = {
  [QUEUE_NAMES.NOTIFICATIONS]: notificationsQueue,
  [QUEUE_NAMES.GPS_FLUSH]: gpsFlushQueue,
  [QUEUE_NAMES.SETTLEMENTS]: settlementsQueue,
  [QUEUE_NAMES.ANALYTICS]: analyticsQueue,
  [QUEUE_NAMES.SCHEDULER]: schedulerQueue,
  [QUEUE_NAMES.CLEANUP]: cleanupQueue,
} as const
