import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { listPendingVehicleDocs } from '@/modules/admin/admin.repository'

describe('listPendingVehicleDocs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects and returns updated_at as a version token for the approve guard', async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{
        id: 1, vehicle_id: 2, doc_type: 'rc', file_url: 'u', doc_number: null,
        status: 'pending', created_at: 't0', updated_at: 't1',
        number_plate: 'OD01', vehicle_name: 'Swift', driver_name: 'A', driver_code: 'D1',
      }],
    } as never)

    const rows = await listPendingVehicleDocs()
    const sql = vi.mocked(pool.query).mock.calls[0]![0] as unknown as string
    expect(sql).toContain('updated_at')
    expect(rows[0]!.updated_at).toBe('t1')
  })
})
