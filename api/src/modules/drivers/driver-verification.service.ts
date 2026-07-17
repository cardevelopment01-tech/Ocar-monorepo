import { uploadFile } from '@/lib/storage'
import { httpError } from '@/lib/errors'
import { findVehicleByDriverId } from './drivers.repository'
import * as repo from './driver-verification.repository'
import type { VerificationStatusToday } from './driver-verification.repository'

export async function getStatus(driverId: bigint): Promise<VerificationStatusToday & { complete: boolean }> {
  const status = await repo.getTodayStatus(driverId)
  return { ...status, complete: status.selfieDone && status.plateDone }
}

export async function submit(
  driverId: bigint,
  files: { selfie: Express.Multer.File; plate: Express.Multer.File }
): Promise<{ complete: true }> {
  const vehicle = await findVehicleByDriverId(driverId)
  if (!vehicle) {
    throw httpError(422, 'No registered vehicle found for this driver', 'NO_VEHICLE')
  }

  const folder = `drivers/${driverId}/daily-verification`
  const [selfieUrl, plateUrl] = await Promise.all([
    uploadFile(files.selfie, `${folder}/selfie`),
    uploadFile(files.plate,  `${folder}/plate`),
  ])

  await repo.insertTodayVerification({
    driverId,
    vehicleId: BigInt(vehicle.id),
    selfieUrl,
    plateUrl,
  })

  return { complete: true }
}
