import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('bullmq', () => ({ Worker: class { on = vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ redisConnection: {}, QUEUE_NAMES: { PAYMENTS: 'payments' } }))
const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/worker-logger', () => ({ createWorkerLogger: () => ({ info: vi.fn(), warn: vi.fn(), error }) }))
vi.mock('@/modules/payments/payments.service', () => ({
  reconcilePendingRidePayments: vi.fn(),
  reconcilePendingPayuPurchases: vi.fn(),
}))
vi.mock('@/modules/rides/rides.service', () => ({ settleStrandedRideCompletions: vi.fn().mockResolvedValue(0) }))
vi.mock('@/modules/packages/packages.service', () => ({ expireDueLots: vi.fn().mockResolvedValue(0) }))

import * as svc from '@/modules/payments/payments.service'
import * as rides from '@/modules/rides/rides.service'
import * as packages from '@/modules/packages/packages.service'
import { runPaymentReconcile } from '@/jobs/workers/payment-reconcile.worker'

describe('payment-reconcile worker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the ride sweep, the PayU purchase/top-up sweep and the package credit expiry sweep', async () => {
    await runPaymentReconcile()
    expect(packages.expireDueLots).toHaveBeenCalledTimes(1)
    expect(svc.reconcilePendingRidePayments).toHaveBeenCalledTimes(1)
    expect(svc.reconcilePendingPayuPurchases).toHaveBeenCalledTimes(1)
    expect(rides.settleStrandedRideCompletions).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })

  it('a failing stranded-ride sweep is logged, not thrown, and the other sweeps still ran', async () => {
    vi.mocked(rides.settleStrandedRideCompletions).mockRejectedValueOnce(new Error('db down'))
    await expect(runPaymentReconcile()).resolves.toBeUndefined()
    expect(svc.reconcilePendingRidePayments).toHaveBeenCalledTimes(1)
    expect(svc.reconcilePendingPayuPurchases).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('a failing ride sweep does not skip the purchase sweep', async () => {
    vi.mocked(svc.reconcilePendingRidePayments).mockRejectedValueOnce(new Error('db down'))
    await expect(runPaymentReconcile()).resolves.toBeUndefined()
    expect(svc.reconcilePendingPayuPurchases).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('a failing package expiry sweep is logged, not thrown, and the stranded-ride sweep still runs', async () => {
    vi.mocked(packages.expireDueLots).mockRejectedValueOnce(new Error('db down'))
    await expect(runPaymentReconcile()).resolves.toBeUndefined()
    expect(rides.settleStrandedRideCompletions).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('a failing purchase sweep is logged, not thrown', async () => {
    vi.mocked(svc.reconcilePendingPayuPurchases).mockRejectedValueOnce(new Error('db down'))
    await expect(runPaymentReconcile()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(1)
  })
})
