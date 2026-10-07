import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { requireDriver } from '@/middleware/role.middleware'

function run(status: string) {
  const json = vi.fn()
  const res = { status: vi.fn().mockReturnValue({ json }) } as unknown as Response
  const next = vi.fn()
  requireDriver('active')({ driver: { status } } as unknown as Request, res, next)
  return { json, next }
}

describe('requireDriver(active)', () => {
  it.each([
    ['pending_docs', 'DRIVER_ONBOARDING_INCOMPLETE'],
    ['pending_approval', 'DRIVER_NOT_APPROVED'],
    ['docs_rejected', 'DRIVER_DOCS_REJECTED'],
    ['suspended', 'DRIVER_SUSPENDED'],
    ['mystery', 'AUTH_FORBIDDEN'],
  ])('%s -> 403 %s', (status, code) => {
    const { json, next } = run(status)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code }))
    expect(next).not.toHaveBeenCalled()
  })

  it('lets active drivers through', () => {
    expect(run('active').next).toHaveBeenCalled()
  })
})
