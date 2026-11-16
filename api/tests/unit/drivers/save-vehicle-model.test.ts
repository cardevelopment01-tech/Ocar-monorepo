import { describe, it, expect, vi, beforeEach } from 'vitest'

// Value: protects=saveVehicleInfo stores the category and seats the MODEL dictates, flags a driver whose model is not listed
// for review, and does not let an already-onboarded driver switch to an unlisted vehicle; fails_when=the driver's own
// category is stored, the review flag is not set/cleared, or an active driver gets the unlisted route; why_new=the server
// stored whatever the app sent; seam=repositories mocked; no_claim=real SQL (the browser/e2e run covers it).

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), get: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn() }, queues: {}, QUEUE_NAMES: {} }))
vi.mock('@/lib/storage', () => ({ getUploadUrl: vi.fn(), promotePendingUpload: vi.fn(), getPresignedUrl: vi.fn() }))
vi.mock('@/modules/safety/safety.repository')
vi.mock('@/modules/drivers/drivers.repository')
vi.mock('@/modules/vehicles/vehicles.repository', () => ({ findModelForRules: vi.fn() }))

import * as repo from '@/modules/drivers/drivers.repository'
import { findModelForRules } from '@/modules/vehicles/vehicles.repository'
import { saveVehicleInfo } from '@/modules/drivers/drivers.service'

const COMPLETE_DRIVER = {
  id: '1', status: 'pending_docs', onboarding_step: 'vehicle_info', full_name: 'Sujal Kumar', gender: 'male',
  date_of_birth: '1990-01-01', residential_address: '1 Test Road, BBSR', state: 'Odisha', city: 'Bhubaneswar', pincode: '751001',
  experience_years: 5, emergency_contact: '9111111111', languages_known: ['English'],
}
const data = (over: Record<string, unknown> = {}) => ({
  category_id: 4, brand_id: 1, model_id: 10, vehicle_name: 'Swift', model_year: 2022, number_plate: 'OD02AB1234', color: 'White',
  fuel_type: 'petrol', seating_capacity: 8, luggage_capacity: 2, ac_availability: true, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(repo.findDriverById).mockResolvedValue(COMPLETE_DRIVER as never)
  vi.mocked(repo.upsertVehicle).mockResolvedValue({ id: '5' } as never)
  vi.mocked(findModelForRules).mockResolvedValue({ id: 10, brand_id: 1, is_active: true, typical_category_id: 1, fuel_types: ['petrol', 'cng'], category_seats: 4 })
})

describe('saveVehicleInfo and the catalogue', () => {
  it("stores the model's category and seats, not the ones the driver sent, and does not flag a review", async () => {
    await saveVehicleInfo(1n, data() as never)
    expect(repo.upsertVehicle).toHaveBeenCalledWith(1n, expect.objectContaining({ category_id: 1, seating_capacity: 4, model_id: 10 }), false)
  })

  it('refuses a fuel the model is not sold with, before anything is stored', async () => {
    await expect(saveVehicleInfo(1n, data({ fuel_type: 'electric' }) as never)).rejects.toMatchObject({ appCode: 'MODEL_FUEL_NOT_AVAILABLE' })
    expect(repo.upsertVehicle).not.toHaveBeenCalled()
  })

  it('a driver still onboarding can register a model that is not listed: their own category is kept and an admin is asked to review', async () => {
    const { model_id: _m, ...unlisted } = data({ category_id: 2, seating_capacity: 4 })
    await saveVehicleInfo(1n, unlisted as never)
    expect(findModelForRules).not.toHaveBeenCalled()
    expect(repo.upsertVehicle).toHaveBeenCalledWith(1n, expect.objectContaining({ category_id: 2, seating_capacity: 4 }), true)
  })

  it('an already-onboarded driver cannot switch to an unlisted vehicle', async () => {
    vi.mocked(repo.findDriverById).mockResolvedValue({ ...COMPLETE_DRIVER, status: 'active', onboarding_step: 'submitted' } as never)
    const { model_id: _m, ...unlisted } = data()
    await expect(saveVehicleInfo(1n, unlisted as never)).rejects.toMatchObject({ httpStatus: 422, appCode: 'MODEL_REQUIRED' })
    expect(repo.upsertVehicle).not.toHaveBeenCalled()
  })

  it('an onboarded driver can still change to another listed model', async () => {
    vi.mocked(repo.findDriverById).mockResolvedValue({ ...COMPLETE_DRIVER, status: 'active', onboarding_step: 'submitted' } as never)
    await saveVehicleInfo(1n, data() as never)
    expect(repo.upsertVehicle).toHaveBeenCalledWith(1n, expect.objectContaining({ category_id: 1 }), false)
  })

  it('a driver awaiting approval or with rejected documents can still fix an unlisted vehicle, for the admin to review', async () => {
    for (const status of ['pending_approval', 'docs_rejected']) {
      vi.mocked(repo.findDriverById).mockResolvedValue({ ...COMPLETE_DRIVER, status } as never)
      const { model_id: _m, ...unlisted } = data()
      await saveVehicleInfo(1n, unlisted as never)
    }
    expect(repo.upsertVehicle).toHaveBeenCalledTimes(2)
  })
})
