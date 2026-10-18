import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

const mockGetConfigValue = vi.fn()
vi.mock('@/lib/system-config', () => ({
  getConfigValue: (...a: unknown[]) => mockGetConfigValue(...a),
}))

import { compareVersions, decideAction, identityFromHeaders, getVersionPolicy } from './app-version.policy'
import { requireSupportedApp } from './app-version.routes'
import { validateConfigBounds } from '@/lib/system-config-bounds'

function config(values: Record<string, string>) {
  mockGetConfigValue.mockImplementation(async (key: string, fallback: string) => values[key] ?? fallback)
}

describe('compareVersions', () => {
  it('orders major / minor / patch numerically', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })
  it('returns null for anything that is not major.minor.patch', () => {
    for (const bad of ['1.2', 'v1.2.3', '1.2.3-beta', '', '1.2.3.4']) {
      expect(compareVersions(bad, '1.0.0')).toBeNull()
    }
  })
})

describe('decideAction', () => {
  it('hard below min, soft below recommended, else none', () => {
    expect(decideAction('1.0.0', '1.1.0', '1.3.0')).toBe('hard')
    expect(decideAction('1.2.0', '1.1.0', '1.3.0')).toBe('soft')
    expect(decideAction('1.3.0', '1.1.0', '1.3.0')).toBe('none')
  })
  it('0.0.0 never prompts, and recommended < min still blocks below min', () => {
    expect(decideAction('1.0.0', '0.0.0', '0.0.0')).toBe('none')
    expect(decideAction('1.0.0', '2.0.0', '1.0.0')).toBe('hard')
  })
  it('an unparseable stored value does not block anyone', () => {
    expect(decideAction('1.0.0', 'garbage', 'garbage')).toBe('none')
  })
})

describe('getVersionPolicy', () => {
  beforeEach(() => { vi.clearAllMocks() })
  const rider = { app: 'rider', platform: 'android', version: '1.0.0' } as const

  it('reads the per-app, per-platform rows', async () => {
    config({ app_update_rider_android_min: '1.1.0', app_update_rider_android_recommended: '1.3.0' })
    expect(await getVersionPolicy(rider)).toEqual({
      action: 'hard',
      min_supported: '1.1.0',
      recommended: '1.3.0',
      store_url: 'https://play.google.com/store/apps/details?id=com.ocar.rider',
    })
  })
  it('kill switch off answers none and iOS has no store url yet', async () => {
    config({ app_update_enabled: 'false', app_update_rider_ios_min: '9.0.0' })
    const p = await getVersionPolicy({ ...rider, platform: 'ios' })
    expect(p.action).toBe('none')
    expect(p.store_url).toBeNull()
  })
})

describe('identityFromHeaders', () => {
  it('needs all three valid headers', () => {
    const h = { 'x-app-name': 'driver', 'x-app-platform': 'android', 'x-app-version': '1.2.3' }
    expect(identityFromHeaders(h)).toEqual({ app: 'driver', platform: 'android', version: '1.2.3' })
    expect(identityFromHeaders({ ...h, 'x-app-version': 'v1' })).toBeNull()
    expect(identityFromHeaders({ ...h, 'x-app-name': 'admin' })).toBeNull()
    expect(identityFromHeaders({})).toBeNull()
  })
})

describe('requireSupportedApp', () => {
  beforeEach(() => { vi.clearAllMocks() })

  async function run(headers: Record<string, string>) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const next = vi.fn()
    const req = { headers, requestId: 'r1' } as unknown as Request
    await requireSupportedApp(req, res, next)
    return { res, next }
  }
  const old = { 'x-app-name': 'driver', 'x-app-platform': 'android', 'x-app-version': '1.0.0' }

  it('passes requests without app headers (web portals, legacy builds)', async () => {
    const { next, res } = await run({})
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
    expect(mockGetConfigValue).not.toHaveBeenCalled()
  })
  it('answers 426 UPGRADE_REQUIRED below the minimum', async () => {
    config({ app_update_driver_android_min: '1.1.0' })
    const { res, next } = await run(old)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(426)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UPGRADE_REQUIRED', requestId: 'r1' }))
  })
  it('a soft-only version and the kill switch both pass', async () => {
    config({ app_update_driver_android_recommended: '9.0.0' })
    expect((await run(old)).next).toHaveBeenCalledOnce()
    config({ app_update_enabled: 'false', app_update_driver_android_min: '9.0.0' })
    expect((await run(old)).next).toHaveBeenCalledOnce()
  })
  it('fails open when config cannot be read', async () => {
    mockGetConfigValue.mockRejectedValue(new Error('db down'))
    const { next, res } = await run(old)
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })
})

describe('system-config bounds for app_update_*', () => {
  it('accepts major.minor.patch and rejects everything else', () => {
    expect(validateConfigBounds('app_update_rider_android_min', '1.2.3')).toBeNull()
    for (const bad of ['1.2', 'v1.2.3', '1.2.3-beta']) {
      expect(validateConfigBounds('app_update_driver_ios_recommended', bad)).toBe('value must look like 1.2.3')
    }
  })
  it('the kill switch is true/false only', () => {
    expect(validateConfigBounds('app_update_enabled', 'false')).toBeNull()
    expect(validateConfigBounds('app_update_enabled', 'off')).not.toBeNull()
  })
})
