import crypto from 'crypto'
import { getUploadUrl, promotePendingUpload } from '@/lib/storage'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { findVehicleByDriverId } from './drivers.repository'
import * as repo from './driver-verification.repository'
import type { VerificationStatusToday } from './driver-verification.repository'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
}

export async function getStatus(driverId: bigint): Promise<VerificationStatusToday & { complete: boolean }> {
  const status = await repo.getTodayStatus(driverId)
  return { ...status, complete: status.selfieDone && status.plateDone }
}

export async function initUpload(
  driverId: bigint,
  kind: 'selfie' | 'plate',
  contentType: string
): Promise<{ upload_url: string; key: string }> {
  const ext = EXT_BY_MIME[contentType] ?? '.bin'
  const key = `uploads/pending/drivers/${driverId}/daily-verification/${kind}/${crypto.randomUUID()}${ext}`
  const uploadUrl = await getUploadUrl(key, contentType)
  return { upload_url: uploadUrl, key }
}

function assertKeyBelongsToDriver(driverId: bigint, key: string, kind: 'selfie' | 'plate'): void {
  if (!key.startsWith(`uploads/pending/drivers/${driverId}/daily-verification/${kind}/`)) {
    throw createHttpError(AppErrors.AUTH_FORBIDDEN)
  }
}

export async function submit(
  driverId: bigint,
  keys: { selfieKey: string; plateKey: string }
): Promise<{ complete: true }> {
  assertKeyBelongsToDriver(driverId, keys.selfieKey, 'selfie')
  assertKeyBelongsToDriver(driverId, keys.plateKey, 'plate')

  const vehicle = await findVehicleByDriverId(driverId)
  if (!vehicle) {
    throw httpError(422, 'No registered vehicle found for this driver', 'NO_VEHICLE')
  }

  const folder = `drivers/${driverId}/daily-verification`
  const [selfieUrl, plateUrl] = await Promise.all([
    promotePendingUpload(keys.selfieKey, `${folder}/selfie`),
    promotePendingUpload(keys.plateKey,  `${folder}/plate`),
  ])

  await repo.insertTodayVerification({
    driverId,
    vehicleId: BigInt(vehicle.id),
    selfieUrl,
    plateUrl,
  })

  return { complete: true }
}
