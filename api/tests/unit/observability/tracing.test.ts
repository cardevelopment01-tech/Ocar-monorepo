import { describe, it, expect } from 'vitest'
import { httpInstrumentationConfig, pgInstrumentationConfig } from '@/observability/tracing'

describe('OTel pg instrumentation config', () => {
  it('disables enhanced database reporting so SQL/params never become span attributes', () => {
    expect(pgInstrumentationConfig.enhancedDatabaseReporting).toBe(false)
  })
})

describe('OTel http instrumentation config', () => {
  const attrs = (url: string) => {
    const set: Record<string, string> = {}
    httpInstrumentationConfig.requestHook({ setAttribute: (k, v) => { set[k] = v } }, { url })
    return set
  }
  it('keeps a live-trip share token out of the span attributes that are exported to Tempo', () => {
    const set = attrs('/api/v1/public/trips/AbCdEfGhIjKlMnOpQrStUv?x=1')
    expect(JSON.stringify(set)).not.toContain('AbCdEfGhIjKlMnOpQrStUv')
    expect(set['http.target']).toBe('/api/v1/public/trips/:token?x=1')
    expect(set['url.path']).toBe('/api/v1/public/trips/:token')
  })
  it('leaves every other request alone', () => {
    expect(attrs('/api/v1/rides/16')).toEqual({})
  })
})
