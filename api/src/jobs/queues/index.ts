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

function parseRedisUrl(url: string): { host: string; port: number; password?: string; tls?: object } {
  const parsed = new URL(url)
  const opts: { host: string; port: number; password?: string; tls?: object } = {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
  }
  if (parsed.password) opts.password = decodeURIComponent(parsed.password)
  if (parsed.protocol === 'rediss:') opts.tls = {}
  return opts
}

const connection = parseRedisUrl(config.REDIS_URL)
export const redisConnection = connection

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
