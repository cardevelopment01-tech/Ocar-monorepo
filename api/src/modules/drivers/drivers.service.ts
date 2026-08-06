import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { uploadFile, getPresignedUrl } from '@/lib/storage'
import { notificationsQueue } from '@/jobs/queues'
import * as repo from './drivers.repository'
import * as safetyRepo from '@/modules/safety/safety.repository'
import type { Driver, DriverVehicle, OnboardingStatus } from './drivers.types'

// ── Completion helpers ────────────────────────────────────────────────────────

function isPersonalInfoComplete(d: Driver): boolean {
  return !!(
    d.full_name &&
    d.gender &&
    d.date_of_birth &&
    d.residential_address &&
    d.state &&
    d.city &&
    d.pincode &&
    d.experience_years !== null &&
    d.emergency_contact &&
    d.languages_known.length > 0
  )
}

const REQUIRED_IDENTITY_DOCS = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
const REQUIRED_VEHICLE_DOCS  = ['vehicle_rc', 'insurance', 'permit']

async function checkDocuments(driverId: bigint): Promise<{ complete: boolean; missing: string[] }> {
  const driver = await repo.findDriverById(driverId)
  const docs = await repo.findDriverDocuments(driverId)
  const uploaded = new Set(docs.map((d) => d.doc_type))
  const missing: string[] = []

  for (const dt of REQUIRED_IDENTITY_DOCS) {
    if (!uploaded.has(dt)) missing.push(dt)
  }
  if (!driver?.license_number) missing.push('license_number')
  if (!driver?.aadhaar_number) missing.push('aadhaar_number')

  const vehicle = await repo.findVehicleByDriverId(driverId)
  if (vehicle) {
    const vehicleDocs = await repo.findVehicleDocuments(vehicle.id)
    const uploadedVehicle = new Set(vehicleDocs.map((d) => d.doc_type))
    for (const dt of REQUIRED_VEHICLE_DOCS) {
      if (!uploadedVehicle.has(dt)) missing.push(dt)
    }
  } else {
    for (const dt of REQUIRED_VEHICLE_DOCS) missing.push(dt)
  }

  return { complete: missing.length === 0, missing }
}

// ── Public service functions ──────────────────────────────────────────────────

export async function getOnboardingStatus(driverId: bigint): Promise<OnboardingStatus> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  const personalComplete = isPersonalInfoComplete(driver)
  const vehicle = await repo.findVehicleByDriverId(driverId)
  const vehicleComplete = !!(vehicle && vehicle.number_plate)
  const { complete: docsComplete, missing } = await checkDocuments(driverId)

  return {
    current_step: driver.onboarding_step,
    personal_info_complete: personalComplete,
    vehicle_info_complete: vehicleComplete,
    documents_complete: docsComplete,
    missing_documents: missing,
  }
}

export async function getMe(driverId: bigint): Promise<{
  driver: Driver
  onboarding: OnboardingStatus
  stats: { total_rides: number; rating_avg: number | null; top_tags: { label: string; count: number }[] }
  billing_mode: 'commission' | 'package' | null
}> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  const [onboarding, totalRides, topTags, billingMode] = await Promise.all([
    getOnboardingStatus(driverId),
    repo.countCompletedRides(driverId),
    safetyRepo.getTopDriverTags(driverId),
    repo.getDriverBillingMode(driverId),
  ])

  const ratingAvg = Number(driver.rating_avg)
  return {
    driver,
    onboarding,
    stats: { total_rides: totalRides, rating_avg: ratingAvg > 0 ? ratingAvg : null, top_tags: topTags },
    billing_mode: billingMode,
  }
}

export async function updateProfile(
  driverId: bigint,
  data: { full_name: string; email?: string }
): Promise<Driver> {
  return repo.updateProfile(driverId, data)
}

export async function getPersonalInfo(driverId: bigint): Promise<Partial<Driver>> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)
  const { full_name, email, gender, date_of_birth, residential_address, state, city,
          pincode, experience_years, emergency_contact, languages_known } = driver
  return { full_name, email, gender, date_of_birth, residential_address, state, city,
           pincode, experience_years, emergency_contact, languages_known }
}

export async function savePersonalInfo(
  driverId: bigint,
  data: {
    full_name: string
    email?: string
    gender: string
    date_of_birth: string
    residential_address: string
    state: string
    city: string
    city_id?: number
    pincode: string
    experience_years: number
    emergency_contact: string
    languages_known: string[]
  }
): Promise<{ next_step: string; driver_code: string }> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  if (data.emergency_contact === driver.phone) {
    throw httpError(422, 'Emergency contact cannot be your own number', 'VALIDATION_ERROR')
  }

  const updated = await repo.updatePersonalInfo(driverId, data)

  await repo.createStatusHistory({
    driverId,
    fromStatus: driver.status,
    toStatus: driver.status,
    reason: 'Personal info step completed',
  })

  return { next_step: updated.onboarding_step, driver_code: updated.code }
}

export async function getVehicleInfo(driverId: bigint): Promise<{ vehicle: DriverVehicle | null }> {
  const vehicle = await repo.findVehicleByDriverId(driverId)
  return { vehicle }
}

export async function saveVehicleInfo(
  driverId: bigint,
  data: {
    category_id: number
    brand_id: number
    model_id?: number
    vehicle_name: string
    model_year: number
    number_plate: string
    color: string
    fuel_type: string
    seating_capacity: number
    luggage_capacity: number
    ac_availability: boolean
    registration_date?: string
  }
): Promise<{ next_step: string; vehicle_id: string }> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  if (!isPersonalInfoComplete(driver)) {
    throw httpError(422, 'Complete personal info first', 'STEP_NOT_COMPLETE')
  }

  const vehicle = await repo.upsertVehicle(driverId, data)

  if (driver.onboarding_step === 'vehicle_info') {
    await repo.setOnboardingStep(driverId, 'documents')
  }

  return { next_step: 'documents', vehicle_id: vehicle.id }
}

export async function saveIdentityDocuments(
  driverId: bigint,
  licenseNumber: string,
  aadhaarNumber: string
): Promise<void> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)
  await repo.updateIdentityDocuments(driverId, licenseNumber, aadhaarNumber)
}

export async function uploadDriverDocument(
  driverId: bigint,
  file: Express.Multer.File,
  docType: string,
  validFrom?: string,
  validUntil?: string
): Promise<{ doc_type: string; file_url: string; status: string }> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  const folder = `drivers/${driverId}/${docType}`
  const fileUrl = await uploadFile(file, folder)

  const validFromDate  = validFrom  ? new Date(validFrom)  : undefined
  const validUntilDate = validUntil ? new Date(validUntil) : undefined

  const doc = await repo.upsertDriverDocument(driverId, docType, fileUrl, validFromDate, validUntilDate)

  if (docType === 'profile_photo') {
    await repo.setReferenceSelfie(driverId, fileUrl)
  }

  return { doc_type: doc.doc_type, file_url: await getPresignedUrl(doc.file_url), status: doc.status }
}

export async function uploadVehicleDocument(
  driverId: bigint,
  file: Express.Multer.File,
  docType: string,
  docNumber?: string,
  validUntil?: string
): Promise<{ doc_type: string; file_url: string; status: string }> {
  const vehicle = await repo.findVehicleByDriverId(driverId)
  if (!vehicle) throw httpError(422, 'Complete vehicle info step first', 'STEP_NOT_COMPLETE')

  const folder = `drivers/${driverId}/vehicle/${docType}`
  const fileUrl = await uploadFile(file, folder)
  const validUntilDate = validUntil ? new Date(validUntil) : undefined

  const doc = await repo.upsertVehicleDocument(vehicle.id, docType, fileUrl, docNumber, validUntilDate)
  return { doc_type: doc.doc_type, file_url: await getPresignedUrl(doc.file_url), status: doc.status }
}

export async function getDocumentStatus(driverId: bigint): Promise<{
  identity: { license_number: string | null; aadhaar_number: string | null }
  photos: Record<string, { uploaded: boolean; url: string | null; status: string | null; rejection_note: string | null }>
  vehicle_docs: Record<string, { uploaded: boolean; url: string | null; status: string | null; rejection_note: string | null }>
  all_required_complete: boolean
  rejection_reason: string | null
}> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  const docs = await repo.findDriverDocuments(driverId)
  const docMap = new Map(docs.map((d) => [d.doc_type, d]))

  const photoTypes = ['profile_photo', 'driving_license', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
  const photos: Record<string, { uploaded: boolean; url: string | null; status: string | null; rejection_note: string | null }> = {}
  for (const dt of photoTypes) {
    const doc = docMap.get(dt)
    photos[dt] = {
      uploaded: !!doc,
      url: doc?.file_url ? await getPresignedUrl(doc.file_url) : null,
      status: doc?.status ?? null,
      rejection_note: doc?.rejection_note ?? null,
    }
  }

  const vehicleDocTypes = ['vehicle_rc', 'insurance', 'permit', 'pollution_cert', 'fitness_cert']
  const vehicleDocs: Record<string, { uploaded: boolean; url: string | null; status: string | null; rejection_note: string | null }> = {}
  const vehicle = await repo.findVehicleByDriverId(driverId)
  const vehicleDocList = vehicle ? await repo.findVehicleDocuments(vehicle.id) : []
  const vehicleDocMap = new Map(vehicleDocList.map((d) => [d.doc_type, d]))
  for (const dt of vehicleDocTypes) {
    const doc = vehicleDocMap.get(dt)
    vehicleDocs[dt] = {
      uploaded: !!doc,
      url: doc?.file_url ? await getPresignedUrl(doc.file_url) : null,
      status: doc?.status ?? null,
      rejection_note: doc?.rejection_note ?? null,
    }
  }

  const { complete } = await checkDocuments(driverId)

  const rejectionReason = driver.status === 'docs_rejected'
    ? await repo.findLatestDocsRejectedReason(driverId)
    : null

  return {
    identity: {
      license_number: driver.license_number,
      aadhaar_number: driver.aadhaar_number ? 'XXXX-XXXX-' + driver.aadhaar_number.slice(-4) : null,
    },
    photos,
    vehicle_docs: vehicleDocs,
    all_required_complete: complete,
    rejection_reason: rejectionReason,
  }
}

export async function submitApplication(
  driverId: bigint
): Promise<{ success: true; status: string }> {
  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  if (!isPersonalInfoComplete(driver)) {
    throw httpError(422, 'Incomplete application', 'INCOMPLETE_APPLICATION')
  }

  const { complete, missing } = await checkDocuments(driverId)
  if (!complete) {
    const err = httpError(422, 'Incomplete application', 'INCOMPLETE_APPLICATION') as Error & {
      httpStatus: number; appCode: string; missing: string[]
    }
    err.missing = missing
    throw err
  }

  await repo.updateDriverStatus(driverId, 'pending_approval', 'submitted')
  await repo.createStatusHistory({
    driverId,
    fromStatus: driver.status,
    toStatus: 'pending_approval',
    reason: 'Driver submitted application',
  })

  await notificationsQueue.add('driver_submitted_for_review', {
    driverId: driverId.toString(),
    driverName: driver.full_name,
    driverPhone: driver.phone,
    submittedAt: new Date().toISOString(),
  })

  return { success: true, status: 'pending_approval' }
}
