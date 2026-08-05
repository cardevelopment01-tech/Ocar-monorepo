import pino from 'pino'
import { config } from '@/config'

// Exported separately from the singleton so the redaction/level logic is
// unit-testable without booting the full app config.
export function buildLoggerOptions(level: string): pino.LoggerOptions {
  const options: pino.LoggerOptions = {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.otp',
        'req.body.password',
        'req.body.phone',
        'req.body.token',
        'otp',
        'phone',
        'password',
        'token',
        '*.otp',
        '*.phone',
        '*.password',
        '*.token',
        '*.start_otp_hash',
        '*.end_otp_hash',
        '*.razorpay_signature',
        '*.account_number',
        '*.accountNumber',
        '*.bank_account_number',
      ],
      censor: '[REDACTED]',
    },
  }
  // exactOptionalPropertyTypes: build first, assign conditionally — never
  // `transport: undefined` (see CLAUDE.md optional-field convention).
  if (config.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    }
  }
  return options
}

export const logger = pino(buildLoggerOptions(config.LOG_LEVEL))
