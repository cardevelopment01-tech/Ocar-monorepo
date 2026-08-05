import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { buildLoggerOptions } from '@/lib/logger'
import { createWorkerLogger } from '@/lib/worker-logger'

describe('createWorkerLogger', () => {
  it('binds the worker name to every log line', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const base = pino(buildLoggerOptions('info'), stream)
    const log = createWorkerLogger('gps-flush', base)

    log.error({ err: new Error('boom'), jobId: '42' }, 'job failed')

    const logged = JSON.parse(lines[0]!)
    expect(logged.worker).toBe('gps-flush')
    expect(logged.jobId).toBe('42')
    expect(logged.err.message).toBe('boom')
  })
})
