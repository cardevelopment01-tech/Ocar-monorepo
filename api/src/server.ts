import './observability/tracing'
import http from 'http'
import { logger } from '@/lib/logger'
import { config } from './config'
import { shutdownTracing } from './observability/tracing'
import { createApp } from './app'
import { testConnection, pool } from './db/client'
import { testConnection as testRedis, client as redisClient } from './db/redis'
import { initSocketServer, getIO } from './websocket/socket.server'
import { notificationsWorker } from './jobs/workers/notifications.worker'
import { dispatchWorker } from './jobs/workers/dispatch.worker'
import { gpsFlushWorker } from './jobs/workers/gps-flush.worker'
import { cleanupWorker } from './jobs/workers/cleanup.worker'
import { schedulerWorker } from './jobs/workers/scheduler.worker'
import { auditWorker } from './jobs/workers/audit.worker'
import { partitionMaintenanceWorker } from './jobs/workers/partition-maintenance.worker'
import { paymentReconcileWorker } from './jobs/workers/payment-reconcile.worker'
import { settlementsWorker } from './jobs/workers/settlements.worker'
import { callMaskingWorker } from './jobs/workers/call-masking.worker'
import { cleanupQueue, schedulerQueue, partitionMaintenanceQueue, paymentsQueue, settlementsQueue, callMaskingQueue } from './jobs/queues'

// Pino writes asynchronously (batched) — process.exit() right after a log
// call can kill the process before that line is flushed to stdout. Since
// these are exactly the "why did the server just die" diagnostics, exit
// only after flush() confirms the write completed.
function exitAfterFlush(code: number): void {
  logger.flush(() => process.exit(code))
}

async function start(): Promise<void> {
  const dbOk = await testConnection()
  if (!dbOk) {
    logger.error('could not connect to database, exiting')
    exitAfterFlush(1)
    return
  }
  logger.info('database connected')

  const redisOk = await testRedis()
  if (!redisOk) {
    logger.error('could not connect to redis, exiting')
    exitAfterFlush(1)
    return
  }

  const app = createApp()
  const httpServer = http.createServer(app)

  initSocketServer(httpServer)

  void notificationsWorker
  logger.info('notifications worker started')
  void dispatchWorker
  logger.info('dispatch worker started')
  void gpsFlushWorker
  logger.info('gps flush worker started')
  void cleanupWorker
  logger.info('cleanup worker started')
  void auditWorker
  logger.info('audit worker started')
  await cleanupQueue.add(
    'sweep_stuck_rides',
    {},
    { repeat: { every: 60_000 }, removeOnComplete: true, removeOnFail: true }
  )

  void schedulerWorker
  logger.info('scheduler worker started')
  await schedulerQueue.add(
    'sweep_scheduled_rides',
    {},
    { repeat: { every: 60_000 }, removeOnComplete: true, removeOnFail: true }
  )
  // Once daily is enough — reminder thresholds are exact-day matches, not windows.
  await schedulerQueue.add(
    'sweep_document_expiry',
    {},
    { repeat: { pattern: '0 4 * * *' }, removeOnComplete: true, removeOnFail: true }
  )
  // §03.4: page all admins for SOS alerts still unacknowledged 5+ minutes
  // after being triggered.
  await schedulerQueue.add(
    'sweep_stale_sos',
    {},
    { repeat: { every: 5 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true }
  )
  // §03.4: page all admins for disputes past their sla_due_at that haven't
  // been resolved/withdrawn.
  await schedulerQueue.add(
    'sweep_dispute_sla',
    {},
    { repeat: { every: 5 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true }
  )

  void partitionMaintenanceWorker
  logger.info('partition maintenance worker started')
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
  // Notification volume is much higher than GPS partitions (one row per chat
  // message, ride event, etc.), so this runs daily rather than monthly.
  await partitionMaintenanceQueue.add(
    'purge_old_notifications',
    {},
    { repeat: { pattern: '0 4 * * *' }, removeOnComplete: true, removeOnFail: true } // daily at 4 AM
  )

  void paymentReconcileWorker
  logger.info('payment reconciliation worker started')
  await paymentsQueue.add(
    'reconcile_pending_payments',
    {},
    { repeat: { every: 300_000 }, removeOnComplete: true, removeOnFail: true }
  )

  void settlementsWorker
  logger.info('settlements worker started')
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
  await settlementsQueue.add(
    'submit_processing_settlements',
    {},
    { repeat: { every: 300_000 }, removeOnComplete: true, removeOnFail: true } // every 5 min
  )

  void callMaskingWorker
  logger.info('call masking worker started')
  await callMaskingQueue.add(
    'sweep_expired_masks',
    {},
    { repeat: { every: 5 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true }
  )
  await callMaskingQueue.add(
    'check_daily_spend',
    {},
    { repeat: { every: 15 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true }
  )

  httpServer.listen(config.API_PORT, () => {
    logger.info({ port: config.API_PORT, env: config.NODE_ENV }, 'server running')
  })

  async function shutdown(): Promise<void> {
    logger.info('shutting down gracefully')

    // Guarantees the process actually exits even if something in the graceful
    // path hangs, instead of the container sitting until the platform's own
    // SIGKILL grace period expires.
    const forceExitTimer = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit')
      process.exit(1)
    }, 10_000)
    forceExitTimer.unref()

    // io.close() disconnects every connected socket (clients auto-reconnect
    // elsewhere via connectionStateRecovery) and closes the underlying HTTP
    // server itself -- calling httpServer.close() separately would double-close
    // it. Plain httpServer.close() alone would never fire its callback while
    // any WebSocket connection is still open: Node only stops accepting new
    // connections, it doesn't close existing ones, and every ride/chat
    // connection is now a long-lived WebSocket (websocket-only transport).
    getIO().close(async () => {
      clearTimeout(forceExitTimer)
      await Promise.all([
        notificationsWorker.close(),
        dispatchWorker.close(),
        gpsFlushWorker.close(),
        cleanupWorker.close(),
        schedulerWorker.close(),
        auditWorker.close(),
        partitionMaintenanceWorker.close(),
        paymentReconcileWorker.close(),
        settlementsWorker.close(),
        callMaskingWorker.close(),
      ])
      await pool.end()
      redisClient.disconnect()
      await shutdownTracing()
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

start().catch((err) => {
  logger.fatal({ err }, 'server startup failed')
  exitAfterFlush(1)
})
