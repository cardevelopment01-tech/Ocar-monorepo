import { describe, it, expect, vi, beforeEach } from 'vitest'

// The validate() middleware only checks a body, it does not replace it, so the value that reaches the database is
// whatever the service passes on. These tests pin that every place a person's name is written stores the CLEANED name,
// and that an unchanged name already on file is never blocked by rules that did not exist when it was saved.

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), get: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn() }, queues: {}, QUEUE_NAMES: {} }))
vi.mock('@/lib/storage', () => ({ getUploadUrl: vi.fn(), promotePendingUpload: vi.fn(), getPresignedUrl: vi.fn() }))
vi.mock('@/modules/safety/safety.repository')
vi.mock('@/modules/drivers/drivers.repository')
vi.mock('@/modules/users/users.repository')
vi.mock('@/modules/emergency-contacts/emergency-contacts.repository')
vi.mock('@/modules/admin/admin.repository')
vi.mock('@/modules/auth/auth.repository', () => ({ findUserById: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn(), notifyAllAdmins: vi.fn() }))
vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: vi.fn() }))
vi.mock('@/modules/rides/rides.service', () => ({ forceResolveRide: vi.fn(), getRideAssignCandidates: vi.fn(), adminAssignDriver: vi.fn(), goOffline: vi.fn() }))
vi.mock('@/modules/rides/rides.repository', () => ({ getActiveSession: vi.fn(), getRideStops: vi.fn() }))
vi.mock('@/modules/ride-chat/ride-chat.repository', () => ({ listMessages: vi.fn() }))

import * as driverRepo from '@/modules/drivers/drivers.repository'
import * as userRepo from '@/modules/users/users.repository'
import * as contactRepo from '@/modules/emergency-contacts/emergency-contacts.repository'
import * as adminRepo from '@/modules/admin/admin.repository'
import { findUserById } from '@/modules/auth/auth.repository'
import * as driverService from '@/modules/drivers/drivers.service'
import * as userService from '@/modules/users/users.service'
import * as contactService from '@/modules/emergency-contacts/emergency-contacts.service'
import * as adminService from '@/modules/admin/admin.service'

beforeEach(() => { vi.clearAllMocks() })

describe('driver names', () => {
  it('profile update stores the cleaned name', async () => {
    vi.mocked(driverRepo.findDriverById).mockResolvedValue({ id: '1', full_name: 'Old Name' } as never)
    await driverService.updateProfile(1n, { full_name: '  sujal   kumar sahoo ' })
    expect(driverRepo.updateProfile).toHaveBeenCalledWith(1n, { full_name: 'Sujal Kumar Sahoo' })
    expect(driverRepo.findDriverById).not.toHaveBeenCalled() // a good name costs no extra read
  })

  it('a driver changing only their email is not blocked by a legacy name that would fail today', async () => {
    vi.mocked(driverRepo.findDriverById).mockResolvedValue({ id: '1', full_name: 'Ravi 🚕 Kumar' } as never)
    await driverService.updateProfile(1n, { full_name: 'Ravi 🚕 Kumar', email: 'r@x.com' })
    expect(driverRepo.updateProfile).toHaveBeenCalledWith(1n, { full_name: 'Ravi 🚕 Kumar', email: 'r@x.com' })
    await expect(driverService.updateProfile(1n, { full_name: 'Ravi 🚕 Different' })).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('onboarding personal info stores the cleaned name and leaves the rest of the data alone', async () => {
    vi.mocked(driverRepo.findDriverById).mockResolvedValue({ id: '1', phone: '9000000001', status: 'pending_docs', full_name: null } as never)
    vi.mocked(driverRepo.updatePersonalInfo).mockResolvedValue({ onboarding_step: 'vehicle', code: 'DRV1' } as never)
    const data = {
      full_name: 'sujal kumar', gender: 'male', date_of_birth: '1990-01-01', residential_address: '1 Test Road, BBSR',
      state: 'Odisha', city: 'Bhubaneswar', pincode: '751001', experience_years: 5, emergency_contact: '9111111111', languages_known: ['en'],
    }
    await driverService.savePersonalInfo(1n, data)
    expect(driverRepo.updatePersonalInfo).toHaveBeenCalledWith(1n, { ...data, full_name: 'Sujal Kumar' })
  })

  it('a driver resuming onboarding with a legacy name on file is not blocked', async () => {
    vi.mocked(driverRepo.findDriverById).mockResolvedValue({ id: '1', phone: '9000000001', status: 'pending_docs', full_name: 'Ravi 9000000001' } as never)
    vi.mocked(driverRepo.updatePersonalInfo).mockResolvedValue({ onboarding_step: 'vehicle', code: 'DRV1' } as never)
    await driverService.savePersonalInfo(1n, {
      full_name: 'Ravi 9000000001', gender: 'male', date_of_birth: '1990-01-01', residential_address: '1 Test Road, BBSR',
      state: 'Odisha', city: 'Bhubaneswar', pincode: '751001', experience_years: 5, emergency_contact: '9111111111', languages_known: ['en'],
    })
    expect(driverRepo.updatePersonalInfo).toHaveBeenCalled()
  })

  it('refuses a name that is not a name, before anything is written', async () => {
    vi.mocked(driverRepo.findDriverById).mockResolvedValue({ id: '1', full_name: 'Old Name' } as never)
    await expect(driverService.updateProfile(1n, { full_name: 'a@b.com' })).rejects.toMatchObject({ httpStatus: 422 })
    expect(driverRepo.updateProfile).not.toHaveBeenCalled()
  })

  it('an admin correction stores the cleaned name too, and rejects a bad one', async () => {
    vi.mocked(driverRepo.findDriverById).mockResolvedValue({ id: '1', full_name: 'Old Name' } as never)
    await adminService.updateDriverProfile(1n, 9n, { full_name: 'RAVI   KUMAR', reason: 'Typo against the driving licence' } as never, null)
    expect(adminRepo.updateDriverProfile).toHaveBeenCalledWith(1n, 9n, { full_name: 'Ravi Kumar' }, 'Typo against the driving licence', null)
    await expect(adminService.updateDriverProfile(1n, 9n, { full_name: '<b>x</b>', reason: 'Typo against the driving licence' } as never, null))
      .rejects.toMatchObject({ httpStatus: 422 })
  })

  it('an admin edit that does not touch the name leaves it out', async () => {
    await adminService.updateDriverProfile(1n, 9n, { license_number: 'OD0120250001', reason: 'Typo against the driving licence' } as never, null)
    expect(adminRepo.updateDriverProfile).toHaveBeenCalledWith(1n, 9n, { license_number: 'OD0120250001' }, expect.any(String), null)
  })
})

describe('rider names', () => {
  it('profile update stores the cleaned name and keeps the email handling', async () => {
    vi.mocked(findUserById).mockResolvedValue({ id: '7', name: 'Old Name' } as never)
    await userService.updateProfile(7n, { full_name: ' priya   das ', email: null })
    expect(userRepo.updateProfile).toHaveBeenCalledWith(7n, { name: 'Priya Das', email: null })
    await userService.updateProfile(7n, { full_name: 'priya das' })
    expect(userRepo.updateProfile).toHaveBeenLastCalledWith(7n, { name: 'Priya Das' })
    expect(findUserById).not.toHaveBeenCalled()
  })

  it('a rider changing only their email is not blocked by a legacy name', async () => {
    vi.mocked(findUserById).mockResolvedValue({ id: '7', name: 'Priya 9000000001' } as never)
    await userService.updateProfile(7n, { full_name: 'Priya 9000000001', email: 'p@x.com' })
    expect(userRepo.updateProfile).toHaveBeenCalledWith(7n, { name: 'Priya 9000000001', email: 'p@x.com' })
  })

  it('refuses an emoji or link as a name', async () => {
    vi.mocked(findUserById).mockResolvedValue({ id: '7', name: 'Old Name' } as never)
    await expect(userService.updateProfile(7n, { full_name: 'Priya 🚕' })).rejects.toMatchObject({ httpStatus: 422 })
    await expect(userService.updateProfile(7n, { full_name: 'www.rides.com' })).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('an emergency contact name is cleaned too (it is texted to other people)', async () => {
    vi.mocked(contactRepo.insertWithinLimit).mockResolvedValue({ result: 'added', contact: { id: '1' } } as never)
    await contactService.addContact(7n, 'maa  ', '+919111111111')
    expect(contactRepo.insertWithinLimit).toHaveBeenCalledWith(7n, 'Maa', '+919111111111', 3)
    await expect(contactService.addContact(7n, 'Call 9000000001 now', '+919111111112')).rejects.toMatchObject({ httpStatus: 422 })
  })
})
