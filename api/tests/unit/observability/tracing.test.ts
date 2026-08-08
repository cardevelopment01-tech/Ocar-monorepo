import { describe, it, expect } from 'vitest'
import { pgInstrumentationConfig } from '@/observability/tracing'

describe('OTel pg instrumentation config', () => {
  it('disables enhanced database reporting so SQL/params never become span attributes', () => {
    expect(pgInstrumentationConfig.enhancedDatabaseReporting).toBe(false)
  })
})
