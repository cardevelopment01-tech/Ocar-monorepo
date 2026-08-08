import { describe, it, expect } from 'vitest'
import { register, httpRequestDuration } from '@/observability/metrics'

describe('metrics registry', () => {
  it('exposes the http request duration histogram under the expected name', async () => {
    httpRequestDuration.observe({ method: 'GET', route: '/health', status_code: '200' }, 0.05)
    const output = await register.metrics()
    expect(output).toContain('http_request_duration_seconds')
    expect(output).toContain('route="/health"')
  })
})
