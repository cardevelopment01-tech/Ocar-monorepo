import * as repo from '@/modules/rides/rides.repository'
import { getConfigValue } from '@/lib/system-config'
import { logger } from '@/lib/logger'

// Dispatch phase 0 helpers (docs/superpowers/plans/2026-11-10-dispatch-phase0-fast-rounds-and-logging.md). Everything here is
// best effort: a settings read or a log write that fails must never stop a ride from being dispatched, so each one catches and
// answers "off" (switches) or logs (writes).
const log = logger.child({ module: 'dispatch-metrics' })

async function switchOn(key: string, fallback: 'true' | 'false'): Promise<boolean> {
  try { return (await getConfigValue(key, fallback)) === 'true' } catch { return false }
}

export const fastRoundsEnabled = (): Promise<boolean> => switchOn('dispatch_fast_rounds_enabled', 'false')
export const decisionLogEnabled = (): Promise<boolean> => switchOn('dispatch_decision_log_enabled', 'true')

export type RoundRecord = {
  rideId: bigint; round: number; radiusM: number; widestRadiusM: number; fastStep: number; categoryIds: bigint[]
  found: number; offered: number; liveSkipped: number; declinedSkipped: number; otherSkipped: number
  outcome: 'offered' | 'empty' | 'closed'
  /** Ask "why few or nobody" only when the wave was not full: the extra query is worth it exactly then. */
  diagFor?: { lat: number; lng: number }
}

export async function recordRound(rec: RoundRecord, enabled: boolean): Promise<void> {
  if (!enabled) return
  try {
    let diag: Record<string, number> | null = null
    if (rec.diagFor) {
      diag = await repo.getDispatchDiag({ lat: rec.diagFor.lat, lng: rec.diagFor.lng, radiusMetres: rec.widestRadiusM, categoryIds: rec.categoryIds })
        .catch((err: unknown) => { log.warn({ err, rideId: rec.rideId.toString() }, 'dispatch diag failed'); return null })
    }
    await repo.insertDispatchRound({
      rideId: rec.rideId, round: rec.round, radiusM: Math.round(rec.radiusM), widestRadiusM: Math.round(rec.widestRadiusM), fastStep: rec.fastStep,
      categoryIds: rec.categoryIds.map(Number), found: rec.found, offered: rec.offered,
      liveSkipped: rec.liveSkipped, declinedSkipped: rec.declinedSkipped, otherSkipped: rec.otherSkipped,
      outcome: rec.outcome, diag,
    })
  } catch (err) {
    log.warn({ err, rideId: rec.rideId.toString(), round: rec.round }, 'dispatch round record failed')
  }
}
