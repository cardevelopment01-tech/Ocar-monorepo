import { describe, it, expect, vi } from 'vitest'
import { register, httpRequestDuration } from '@/observability/metrics'
import { queues } from '@/jobs/queues'

describe('metrics registry', () => {
  it('exposes the http request duration histogram under the expected name', async () => {
    httpRequestDuration.observe({ method: 'GET', route: '/health', status_code: '200' }, 0.05)
    const output = await register.metrics()
    expect(output).toContain('http_request_duration_seconds')
    expect(output).toContain('route="/health"')
  })

  it('reports all three database pools so the connection budget can be watched', async () => {
    const output = await register.metrics()
    for (const name of ['pg_pool_connections', 'pg_worker_pool_connections', 'pg_analytics_pool_connections']) {
      for (const state of ['total', 'idle', 'waiting']) {
        expect(output).toContain(`${name}{state="${state}"}`)
      }
    }
  })

  it('does not blank the whole scrape when one queue fails to report job counts', async () => {
    const spy = vi
      .spyOn(queues.dispatch, 'getJobCounts')
      .mockRejectedValueOnce(new Error('redis hiccup'))

    const output = await register.metrics()

    expect(output).toContain('http_request_duration_seconds')
    expect(output).toContain('pg_pool_connections')
    spy.mockRestore()
  })
})
