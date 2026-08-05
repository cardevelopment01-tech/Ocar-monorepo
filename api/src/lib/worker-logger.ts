import type pino from 'pino'
import { logger } from '@/lib/logger'

// One child logger per BullMQ worker, tagged with the worker name so a Loki
// query can filter to `worker="gps-flush"` etc. `base` defaults to the app's
// singleton logger; tests pass an isolated base to override it.
export function createWorkerLogger(workerName: string, base: pino.Logger = logger): pino.Logger {
  return base.child({ worker: workerName })
}
