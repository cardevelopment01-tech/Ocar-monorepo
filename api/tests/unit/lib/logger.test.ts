import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { trace, context, ROOT_CONTEXT, type Context, type ContextManager } from '@opentelemetry/api'
import { buildLoggerOptions } from '@/lib/logger'

// The real SDK (api/src/observability/tracing.ts) registers a context manager
// via NodeSDK.start(), but that's skipped in NODE_ENV=test (see that file) so
// span context never propagates into `context.with`/`context.active` here.
// This is a minimal synchronous stand-in — just enough for this test to
// exercise the real trace/context API — not a replacement for the SDK's
// AsyncHooksContextManager (no async boundaries are crossed in this test).
class SyncTestContextManager implements ContextManager {
  private current: Context = ROOT_CONTEXT
  active(): Context {
    return this.current
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const previous = this.current
    this.current = ctx
    try {
      return fn.apply(thisArg, args)
    } finally {
      this.current = previous
    }
  }
  bind<T>(_ctx: Context, target: T): T {
    return target
  }
  enable(): this {
    return this
  }
  disable(): this {
    return this
  }
}
context.setGlobalContextManager(new SyncTestContextManager())

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

  it('redacts driverPhone/userPhone/recipientPhone/riderPhone field variants', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino(buildLoggerOptions('info'), stream)

    logger.info({
      driverPhone: '9876543210',
      userPhone: '9876543211',
      recipientPhone: '9876543212',
      riderPhone: '9876543213',
    }, 'phone variant event')

    const logged = JSON.parse(lines[0]!)
    expect(logged.driverPhone).toBe('[REDACTED]')
    expect(logged.userPhone).toBe('[REDACTED]')
    expect(logged.recipientPhone).toBe('[REDACTED]')
    expect(logged.riderPhone).toBe('[REDACTED]')
  })

  it('does not emit debug logs when level is info', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino(buildLoggerOptions('info'), stream)

    logger.debug({ sessionId: 'abc' }, 'gps ping received')

    expect(lines.length).toBe(0)
  })

  it('includes trace_id in the log when a span is active, omits it otherwise', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino(buildLoggerOptions('info'), stream)

    logger.info({}, 'no span active')
    const withoutSpan = JSON.parse(lines[0]!)
    expect(withoutSpan.trace_id).toBeUndefined()

    const tracer = trace.getTracer('test')
    const span = tracer.startSpan('test-span')
    context.with(trace.setSpan(context.active(), span), () => {
      logger.info({}, 'span active')
    })
    span.end()

    const withSpan = JSON.parse(lines[1]!)
    expect(withSpan.trace_id).toBe(span.spanContext().traceId)
  })
})
