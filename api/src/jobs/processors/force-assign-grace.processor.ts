import * as service from '@/modules/rides/rides.service'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'force-assign-grace-processor' })

export interface ForceAssignGraceJobData {
  rideId: string
  driverId: string
}

export async function processForceAssignGraceCheck(data: ForceAssignGraceJobData): Promise<void> {
  try {
    await service.forceAssignGraceCheck(BigInt(data.rideId), BigInt(data.driverId))
  } catch (err) {
    log.error({ err, rideId: data.rideId, driverId: data.driverId }, 'force-assign grace check failed')
    throw err
  }
}
