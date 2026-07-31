import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  updateDriverVehicle: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
}))

import * as repo from '@/modules/admin/admin.repository'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { updateDriverVehicle } from '@/modules/admin/admin.service'

const ADMIN_ID   = BigInt(1)
const DRIVER_ID  = BigInt(42)
const VEHICLE_ID = BigInt(7)
const VALID_REASON = 'Driver picked the wrong category at onboarding, corrected to match the RC'

describe('updateDriverVehicle', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a missing reason', async () => {
    await expect(updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { vehicle_name: 'Swift' } as never, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateDriverVehicle).not.toHaveBeenCalled()
  })

  it('rejects a reason shorter than 10 characters', async () => {
    await expect(updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { vehicle_name: 'Swift', reason: 'too short' }, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateDriverVehicle).not.toHaveBeenCalled()
  })

  it('rejects a request with no fields to change', async () => {
    await expect(updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { reason: VALID_REASON }, null))
      .rejects.toBeTruthy()
    expect(repo.updateDriverVehicle).not.toHaveBeenCalled()
  })

  it('converts category_id/brand_id/model_id from string to bigint before calling the repo', async () => {
    await updateDriverVehicle(
      DRIVER_ID, VEHICLE_ID, ADMIN_ID,
      { category_id: '3', brand_id: '5', model_id: '9', reason: VALID_REASON },
      '1.2.3.4'
    )
    expect(repo.updateDriverVehicle).toHaveBeenCalledWith(
      VEHICLE_ID, ADMIN_ID,
      { category_id: BigInt(3), brand_id: BigInt(5), model_id: BigInt(9) },
      VALID_REASON, '1.2.3.4'
    )
  })

  it('rejects a non-numeric category_id instead of throwing a raw BigInt SyntaxError', async () => {
    await expect(updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { category_id: 'abc', reason: VALID_REASON }, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateDriverVehicle).not.toHaveBeenCalled()
  })

  it('passes model_id: null through as null (clearing the model), not as undefined', async () => {
    await updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { model_id: null, reason: VALID_REASON }, null)
    expect(repo.updateDriverVehicle).toHaveBeenCalledWith(
      VEHICLE_ID, ADMIN_ID, { model_id: null }, VALID_REASON, null
    )
  })

  it('passes non-FK fields through unchanged and notifies the driver', async () => {
    await updateDriverVehicle(
      DRIVER_ID, VEHICLE_ID, ADMIN_ID,
      { number_plate: 'OD-02-AB-1234', seating_capacity: 4, ac_availability: true, reason: VALID_REASON },
      null
    )
    expect(repo.updateDriverVehicle).toHaveBeenCalledWith(
      VEHICLE_ID, ADMIN_ID,
      { number_plate: 'OD-02-AB-1234', seating_capacity: 4, ac_availability: true },
      VALID_REASON, null
    )
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: DRIVER_ID }))
  })
})
