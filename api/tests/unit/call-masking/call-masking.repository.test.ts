import { describe, it, expect, vi, beforeEach } from 'vitest'

// This repo's convention for repository-level "unit" tests is a mocked
// pool/client, not a real DB (see tests/unit/ride-chat/ride-chat.repository.test.ts
// and tests/unit/payments/confirm-ride-payment.test.ts) — real-DB tests live under
// tests/integration/ with their own migration-running setup. Adapted the task's
// literal real-DB test to that pattern rather than fabricating a rides/users/
// vehicle_categories FK chain in a "unit" test.
//
// Transactional repo functions use the shared `withTransaction` helper
// (api/src/db/client.ts) rather than hand-rolled BEGIN/COMMIT/ROLLBACK, so the
// mock here just runs the callback against a fake client — BEGIN/COMMIT/ROLLBACK
// and release() are the helper's own concern, not this repository's.
const fakeClient = { query: vi.fn() }
vi.mock('@/db/client', () => ({
  pool: { query: vi.fn() },
  withTransaction: vi.fn((fn: (client: typeof fakeClient) => unknown) => fn(fakeClient)),
}))

import { pool, withTransaction } from '@/db/client'
import * as repo from '@/modules/call-masking/call-masking.repository'

describe('call-masking repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('allocateNumber', () => {
    it('allocates an available number and marks it allocated', async () => {
      fakeClient.query
        .mockResolvedValueOnce({ rows: [{ id: '7', virtual_number: '+911111111111' }] }) // SELECT ... FOR UPDATE SKIP LOCKED
        .mockResolvedValueOnce({ rows: [] }) // UPDATE exotel_number_pool SET status = 'allocated'
        .mockResolvedValueOnce({
          rows: [
            {
              id: '3',
              ride_id: '1',
              virtual_number: '+911111111111',
              driver_phone: '+919000000001',
              rider_phone: '+919000000002',
              call_count: 0,
              expires_at: new Date('2026-08-07T01:00:00.000Z'),
            },
          ],
        }) // INSERT INTO ride_call_masks

      const mask = await repo.allocateNumber({
        rideId: 1n,
        driverPhone: '+919000000001',
        riderPhone: '+919000000002',
        ttlMinutes: 60,
      })

      expect(withTransaction).toHaveBeenCalledTimes(1)
      expect(mask).not.toBeNull()
      expect(mask!.virtualNumber).toBe('+911111111111')
      expect(mask!.id).toBe(3n)
      expect(mask!.rideId).toBe(1n)
      expect(typeof mask!.id).toBe('bigint')

      const allocateUpdateCall = fakeClient.query.mock.calls[1]!
      expect(allocateUpdateCall[0] as string).toContain("status = 'allocated'")
      expect(allocateUpdateCall[1]).toEqual(['7'])

      const insertCall = fakeClient.query.mock.calls[2]!
      expect(insertCall[0] as string).toContain('INSERT INTO ride_call_masks')
      expect(insertCall[1]).toEqual([1n, '7', '+911111111111', '+919000000001', '+919000000002', 60])
    })

    it('returns null when the pool is exhausted', async () => {
      fakeClient.query.mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE SKIP LOCKED — nothing available

      const mask = await repo.allocateNumber({
        rideId: 2n,
        driverPhone: '+919000000001',
        riderPhone: '+919000000002',
        ttlMinutes: 60,
      })

      expect(mask).toBeNull()
      expect(fakeClient.query).toHaveBeenCalledTimes(1) // never reached the UPDATE/INSERT
    })

    it('propagates a query error to the caller (withTransaction handles rollback)', async () => {
      fakeClient.query.mockRejectedValueOnce(new Error('db exploded')) // SELECT fails

      await expect(
        repo.allocateNumber({ rideId: 3n, driverPhone: '+919000000001', riderPhone: '+919000000002', ttlMinutes: 60 })
      ).rejects.toThrow('db exploded')
    })
  })

  describe('getActiveMaskForRide', () => {
    it('returns null when no active mask exists', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never)
      const mask = await repo.getActiveMaskForRide(1n)
      expect(mask).toBeNull()
    })

    it('returns the mask converted to bigint fields', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [
          {
            id: '3',
            ride_id: '1',
            virtual_number: '+911111111111',
            driver_phone: '+919000000001',
            rider_phone: '+919000000002',
            call_count: 2,
            expires_at: new Date('2026-08-07T01:00:00.000Z'),
          },
        ],
      } as never)
      const mask = await repo.getActiveMaskForRide(1n)
      expect(mask).toEqual({
        id: 3n,
        rideId: 1n,
        virtualNumber: '+911111111111',
        driverPhone: '+919000000001',
        riderPhone: '+919000000002',
        callCount: 2,
        expiresAt: new Date('2026-08-07T01:00:00.000Z'),
      })
    })
  })

  describe('releaseByRideId', () => {
    it('releases the mask and frees the pool number when an active mask exists', async () => {
      fakeClient.query
        .mockResolvedValueOnce({ rows: [{ pool_number_id: '7' }] }) // UPDATE ride_call_masks ... RETURNING pool_number_id
        .mockResolvedValueOnce({ rows: [] }) // UPDATE exotel_number_pool SET status = 'available'

      await repo.releaseByRideId(1n)

      expect(withTransaction).toHaveBeenCalledTimes(1)
      expect(fakeClient.query.mock.calls[1]![0] as string).toContain("status = 'available'")
      expect(fakeClient.query.mock.calls[1]![1]).toEqual(['7'])
    })

    it('is a no-op on the pool when no active mask is found', async () => {
      fakeClient.query.mockResolvedValueOnce({ rows: [] }) // UPDATE ride_call_masks ... nothing matched

      await repo.releaseByRideId(99n)

      expect(fakeClient.query).toHaveBeenCalledTimes(1) // never touched exotel_number_pool
    })
  })

  describe('incrementCallCount', () => {
    it('increments call_count for the given mask id', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never)
      await repo.incrementCallCount(3n)
      const call = vi.mocked(pool.query).mock.calls[0]!
      expect(call[0] as string).toContain('call_count = call_count + 1')
      expect(call[1]).toEqual([3n])
    })
  })

  describe('releaseExpiredMasks', () => {
    it('releases each expired mask and frees its pool number, returning the count', async () => {
      fakeClient.query
        .mockResolvedValueOnce({ rows: [{ pool_number_id: '7' }, { pool_number_id: '8' }] }) // UPDATE ride_call_masks ... RETURNING pool_number_id
        .mockResolvedValueOnce({ rows: [] }) // UPDATE exotel_number_pool for 7
        .mockResolvedValueOnce({ rows: [] }) // UPDATE exotel_number_pool for 8

      const count = await repo.releaseExpiredMasks()

      expect(count).toBe(2)
      const sweepCall = fakeClient.query.mock.calls[0]!
      expect(sweepCall[0] as string).toContain("status = 'active' AND expires_at < now()")

      const freeCall1 = fakeClient.query.mock.calls[1]!
      expect(freeCall1[0] as string).toContain("status = 'available'")
      expect(freeCall1[1]).toEqual(['7'])

      const freeCall2 = fakeClient.query.mock.calls[2]!
      expect(freeCall2[0] as string).toContain("status = 'available'")
      expect(freeCall2[1]).toEqual(['8'])
    })

    it('returns 0 and touches no pool rows when nothing is expired', async () => {
      fakeClient.query.mockResolvedValueOnce({ rows: [] }) // UPDATE ride_call_masks ... nothing matched

      const count = await repo.releaseExpiredMasks()

      expect(count).toBe(0)
      expect(fakeClient.query).toHaveBeenCalledTimes(1) // no pool row freed
    })
  })

  describe('recordCallEvent', () => {
    it('returns true when the insert lands (not a duplicate call_sid)', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: '1' }] } as never)
      const inserted = await repo.recordCallEvent({
        rideCallMaskId: 3n,
        callSid: 'CA123',
        rawPayload: { foo: 'bar' },
      })
      expect(inserted).toBe(true)
      const call = vi.mocked(pool.query).mock.calls[0]!
      expect(call[0] as string).toContain('ON CONFLICT (call_sid) DO NOTHING')
      expect(call[1]).toEqual([3n, 'CA123', null, null, null, JSON.stringify({ foo: 'bar' })])
    })

    it('returns false when call_sid already recorded', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never)
      const inserted = await repo.recordCallEvent({
        rideCallMaskId: 3n,
        callSid: 'CA123',
        rawPayload: {},
      })
      expect(inserted).toBe(false)
    })
  })

  describe('getTodaySpendInr', () => {
    it('sums today\'s call event spend', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ total: '123.45' }] } as never)
      const total = await repo.getTodaySpendInr()
      expect(total).toBe(123.45)
    })

    it('returns 0 when there are no events today', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ total: '0' }] } as never)
      const total = await repo.getTodaySpendInr()
      expect(total).toBe(0)
    })
  })
})
