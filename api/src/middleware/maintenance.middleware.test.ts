import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetMaintenanceStatus = vi.fn()

vi.mock('@/lib/maintenance', () => ({
  getMaintenanceStatus: (...a: unknown[]) => mockGetMaintenanceStatus(...a),
}))

import { maintenanceCheck } from './maintenance.middleware'

function makeRes() {
  const res: { statusCode?: number; headers: Record<string, string>; body?: unknown } & Record<string, unknown> = {
    headers: {},
  }
  res['status'] = vi.fn((code: number) => { res.statusCode = code; return res })
  res['json'] = vi.fn((body: unknown) => { res.body = body; return res })
  res['set'] = vi.fn((key: string, value: string) => { res.headers[key] = value; return res })
  return res as unknown as import('express').Response & { statusCode?: number; headers: Record<string, string>; body?: unknown }
}

describe('maintenanceCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bypasses /health even when maintenance is enabled', async () => {
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: true })
    const req = { path: '/health', requestId: 'r1' } as unknown as import('express').Request
    const res = makeRes()
    const next = vi.fn()

    await maintenanceCheck(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('responds 503 with MAINTENANCE_MODE code and Retry-After when enabled', async () => {
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: true, message: 'brb', retryAfterSeconds: 30 })
    const req = { path: '/api/v1/rides', requestId: 'r2' } as unknown as import('express').Request
    const res = makeRes()
    const next = vi.fn()

    await maintenanceCheck(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(503)
    expect(res.headers['Retry-After']).toBe('30')
    expect(res.body).toMatchObject({ code: 'MAINTENANCE_MODE', message: 'brb', requestId: 'r2' })
  })

  it('lets the request through when disabled', async () => {
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: false })
    const req = { path: '/api/v1/rides', requestId: 'r3' } as unknown as import('express').Request
    const res = makeRes()
    const next = vi.fn()

    await maintenanceCheck(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('fails open when the status check throws', async () => {
    mockGetMaintenanceStatus.mockRejectedValue(new Error('redis down'))
    const req = { path: '/api/v1/rides', requestId: 'r4' } as unknown as import('express').Request
    const res = makeRes()
    const next = vi.fn()

    await maintenanceCheck(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })
})
