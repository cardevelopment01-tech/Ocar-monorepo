import type pino from 'pino'
import { logger } from '@/lib/logger'

// One child logger per BullMQ worker, tagged with the worker name so a Loki
// query can filter to `worker="gps-flush"` etc. `base` is explicitly typed
// as `pino.Logger | undefined` (rather than a default parameter) so it can
// stay before the required `workerName` param — call sites pass `undefined`
// to use the app's singleton logger; tests pass an isolated base instead.
export function createWorkerLogger(base: pino.Logger | undefined, workerName: string): pino.Logger {
  return (base ?? logger).child({ worker: workerName })
}
