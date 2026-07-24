import http from 'http'
import { config } from './config'
import { createApp } from './app'
import { testConnection, pool } from './db/client'
import { testConnection as testRedis, client as redisClient } from './db/redis'
import { initSocketServer } from './websocket/socket.server'
import { notificationsWorker } from './jobs/workers/notifications.worker'
import { dispatchWorker } from './jobs/workers/dispatch.worker'
import { gpsFlushWorker } from './jobs/workers/gps-flush.worker'
import { cleanupWorker } from './jobs/workers/cleanup.worker'
import { schedulerWorker } from './jobs/workers/scheduler.worker'
import { auditWorker } from './jobs/workers/audit.worker'
import { partitionMaintenanceWorker } from './jobs/workers/partition-maintenance.worker'
import { paymentReconcileWorker } from './jobs/workers/payment-reconcile.worker'
import { settlementsWorker } from './jobs/workers/settlements.worker'
import { cleanupQueue, schedulerQueue, partitionMaintenanceQueue, paymentsQueue, settlementsQueue } from './jobs/queues'

async function start(): Promise<void> {
  const dbOk = await testConnection()
  if (!dbOk) {
    console.error('ERROR: Could not connect to database. Exiting.')
    process.exit(1)
  }
  console.log('Database connected')

  const redisOk = await testRedis()
  if (!redisOk) {
    console.error('ERROR: Could not connect to Redis. Exiting.')
    process.exit(1)
  }

  const app = createApp()
  const httpServer = http.createServer(app)

  initSocketServer(httpServer)

  void notificationsWorker
  console.log('[Worker] Notifications worker started')
  void dispatchWorker
  console.log('[Worker] Dispatch worker started')
  void gpsFlushWorker
  console.log('[Worker] GPS flush worker started')
  void cleanupWorker
  console.log('[Worker] Cleanup worker started')
  void auditWorker
  console.log('[Worker] Audit worker started')
  await cleanupQueue.add(
    'sweep_stuck_rides',
    {},
    { repeat: { every: 60_000 }, removeOnComplete: true, removeOnFail: true }
  )

  void schedulerWorker
  console.log('[Worker] Scheduler worker started')
  await schedulerQueue.add(
    'sweep_scheduled_rides',
    {},
    { repeat: { every: 60_000 }, removeOnComplete: true, removeOnFail: true }
  )

  void partitionMaintenanceWorker
  console.log('[Worker] Partition maintenance worker started')
  // Runs on the 25th of each month (same convention ADR-003 specified),
  // ahead of month-end so next month's partition exists before it's needed.
  await partitionMaintenanceQueue.add(
    'create_next_partition',
    {},
    { repeat: { pattern: '0 3 25 * *' }, removeOnComplete: true, removeOnFail: true }
  )
  // Runs 30 minutes later, same day. No ordering dependency on the create job
  // above — purge only touches partitions past the 90-day retention window,
  // never the partition just created — the stagger is just tidy scheduling.
  await partitionMaintenanceQueue.add(
    'purge_old_partitions',
    {},
    { repeat: { pattern: '30 3 25 * *' }, removeOnComplete: true, removeOnFail: true }
  )

  void paymentReconcileWorker
  console.log('[Worker] Payment reconciliation worker started')
  await paymentsQueue.add(
    'reconcile_pending_payments',
    {},
    { repeat: { every: 300_000 }, removeOnComplete: true, removeOnFail: true }
  )

  void settlementsWorker
  console.log('[Worker] Settlements worker started')
  await settlementsQueue.add(
    'clear_available_earnings',
    {},
    { repeat: { every: 900_000 }, removeOnComplete: true, removeOnFail: true } // 15 min
  )
  await settlementsQueue.add(
    'run_scheduled_settlement_batch',
    {},
    { repeat: { pattern: '0 2 * * *' }, removeOnComplete: true, removeOnFail: true } // daily at 2 AM
  )

  httpServer.listen(config.API_PORT, () => {
    console.log(
      `Server running on port ${config.API_PORT} [${config.NODE_ENV}]`
    )
  })

  async function shutdown(): Promise<void> {
    console.log('Shutting down gracefully...')
    httpServer.close(async () => {
      await pool.end()
      redisClient.disconnect()
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
