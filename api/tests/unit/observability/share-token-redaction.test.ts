import { describe, it, expect } from 'vitest'
import { redactShareToken, serializeReq } from '@/observability/http-log'

// Value: protects=a live-trip link's secret never reaches Grafana Cloud or the S3 log archive; fails_when=the redaction is
// removed or the serializer stops using it; why_new=tokens travel in the path of the public endpoint (eng review D10);
// seam=none; no_claim=proxy/CDN access logs outside the app (a rollout check).
describe('redactShareToken', () => {
  it('replaces the token segment and leaves the rest of the path', () => {
    expect(redactShareToken('/api/v1/public/trips/abcdefghijklmnopqrstuv')).toBe('/api/v1/public/trips/:token')
    expect(redactShareToken('/api/v1/rides/16/shares')).toBe('/api/v1/rides/16/shares')
    expect(redactShareToken(undefined)).toBeUndefined()
  })

  it('the request log line carries :token, never the token, and still drops the query string', () => {
    const logged = serializeReq({ url: '/api/v1/public/trips/SECRETSECRETSECRET123?x=1', headers: {} })
    expect(logged.url).toBe('/api/v1/public/trips/:token')
    expect(JSON.stringify(logged)).not.toContain('SECRET')
  })
})
