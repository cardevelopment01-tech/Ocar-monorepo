import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { buildLoggerOptions } from '@/lib/logger'

describe('logger redaction', () => {
  it('redacts phone, otp, password, and auth header fields', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino(buildLoggerOptions('info'), stream)

    logger.info({
      req: { headers: { authorization: 'Bearer secret-token' } },
      phone: '9876543210',
      otp: '1234',
      password: 'hunter2',
    }, 'test event')

    const logged = JSON.parse(lines[0]!)
    expect(logged.req.headers.authorization).toBe('[REDACTED]')
    expect(logged.phone).toBe('[REDACTED]')
    expect(logged.otp).toBe('[REDACTED]')
    expect(logged.password).toBe('[REDACTED]')
    expect(logged.msg).toBe('test event')
  })

  it('does not emit debug logs when level is info', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino(buildLoggerOptions('info'), stream)

    logger.debug({ sessionId: 'abc' }, 'gps ping received')

    expect(lines.length).toBe(0)
  })
})
