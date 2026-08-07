import { Queue } from 'bullmq'
import { client as connection } from '@/db/redis'

export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  DISPATCH: 'dispatch',
  GPS_FLUSH: 'gps-flush',
  SETTLEMENTS: 'settlements',
  ANALYTICS: 'analytics',
  SCHEDULER: 'scheduler',
  CLEANUP: 'cleanup',
  AUDIT: 'audit',
  PARTITION_MAINTENANCE: 'partition-maintenance',
  PAYMENTS: 'payments',
  CALL_MASKING: 'call-masking',
} as const

// Shared ioredis instance (not a plain options object) so BullMQ reuses one
// connection across all queues instead of opening a new socket per queue.
// Workers still duplicate one blocking connection each — that's unavoidable.
export const redisConnection = connection

export const notificationsQueue = new Queue(QUEUE_NAMES.NOTIFICATIONS, {
  connection,
})
// Ride-matching fan-out (broadcast_ride, broadcast_ride_ack_check) — split out
// of notificationsQueue so a burst of dispatch jobs never delays SMS sends,
// which share a rate-limited worker (see notifications.worker.ts).
export const dispatchQueue = new Queue(QUEUE_NAMES.DISPATCH, { connection })
export const gpsFlushQueue = new Queue(QUEUE_NAMES.GPS_FLUSH, { connection })
export const settlementsQueue = new Queue(QUEUE_NAMES.SETTLEMENTS, {
  connection,
})
export const analyticsQueue = new Queue(QUEUE_NAMES.ANALYTICS, { connection })
export const schedulerQueue = new Queue(QUEUE_NAMES.SCHEDULER, { connection })
export const cleanupQueue = new Queue(QUEUE_NAMES.CLEANUP, { connection })
export const auditQueue = new Queue(QUEUE_NAMES.AUDIT, { connection })
export const partitionMaintenanceQueue = new Queue(QUEUE_NAMES.PARTITION_MAINTENANCE, { connection })
export const paymentsQueue = new Queue(QUEUE_NAMES.PAYMENTS, { connection })
export const callMaskingQueue = new Queue(QUEUE_NAMES.CALL_MASKING, { connection })

export const queues = {
  [QUEUE_NAMES.NOTIFICATIONS]: notificationsQueue,
  [QUEUE_NAMES.DISPATCH]: dispatchQueue,
  [QUEUE_NAMES.GPS_FLUSH]: gpsFlushQueue,
  [QUEUE_NAMES.SETTLEMENTS]: settlementsQueue,
  [QUEUE_NAMES.ANALYTICS]: analyticsQueue,
  [QUEUE_NAMES.SCHEDULER]: schedulerQueue,
  [QUEUE_NAMES.CLEANUP]: cleanupQueue,
  [QUEUE_NAMES.AUDIT]: auditQueue,
  [QUEUE_NAMES.PARTITION_MAINTENANCE]: partitionMaintenanceQueue,
  [QUEUE_NAMES.PAYMENTS]: paymentsQueue,
  [QUEUE_NAMES.CALL_MASKING]: callMaskingQueue,
} as const
