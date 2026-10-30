import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { buildLoggerOptions } from '@/lib/logger'

describe('logger redaction of identity and contact fields', () => {
  it('redacts Aadhaar, licence, email, date of birth and address at the top level and one level down', () => {
    const lines: string[] = []
    const logger = pino(buildLoggerOptions('info'), { write: (l: string) => { lines.push(l) } })

    logger.info({ aadhaar_number: '123412341234', license_number: 'OD0120200001234', email: 'rider@example.com' }, 'flat')
    logger.error({ driver: { id: '7', aadhaar_number: '123412341234', license_number: 'OD0120200001234', email: 'd@example.com', date_of_birth: '1990-01-01', residential_address: '12 Main Road' } }, 'whole row')

    const all = lines.join('')
    for (const secret of ['123412341234', 'OD0120200001234', 'rider@example.com', 'd@example.com', '1990-01-01', '12 Main Road']) {
      expect(all).not.toContain(secret)
    }
    expect(all).toContain('[REDACTED]')
    expect(all).toContain('"id":"7"') // non-sensitive fields still logged
  })
})
