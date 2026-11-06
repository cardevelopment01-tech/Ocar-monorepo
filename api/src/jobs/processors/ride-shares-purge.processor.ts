import { logger } from '@/lib/logger'

const log = logger.child({ module: 'ride-shares-purge-processor' })

// Deletes live trip links 30 days after their ride ended (anything older than 37 days goes regardless, since a link dies 7 days
// after creation). A link is inert long before this; the purge keeps contact phone numbers from being kept longer than needed.
export async function processPurgeRideShares(): Promise<void> {
  // Dynamic import: see partition-purge.processor.ts for why (avoids a top-level @/config import crashing unrelated suites).
  const { purgeOld } = await import('@/modules/ride-shares/ride-shares.repository')
  const deleted = await purgeOld()
  log.info({ deleted }, 'purged old ride_shares rows')
}
