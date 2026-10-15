import { relaunchRoute, type RelaunchRideSummary } from '@/features/active-ride/relaunchRouting'

export const STATUS_SCREEN = '/onboarding/pending-review'

export type Restriction = 'suspended' | 'banned'

export function restrictionOf(status: string | null | undefined): Restriction | null {
  return status === 'suspended' || status === 'banned' ? status : null
}

// Where a launch (or a status change while the app is open) should land. The status screens are the ONLY place a
// restricted driver can be: Home would let them tap "Go online" just to be refused. A suspended driver who is
// mid-trip keeps their ride (the server leaves ride routes open for them so a passenger is never stranded); a banned
// one is blocked everywhere, so no ride lookup is made for them.
export function standingRoute(status: string | null | undefined, activeRide: RelaunchRideSummary): string {
  const restriction = restrictionOf(status)
  if (restriction === 'banned') return STATUS_SCREEN
  if (restriction === 'suspended' && !activeRide) return STATUS_SCREEN
  return relaunchRoute(activeRide)
}

// 403 codes the API uses for an account that is no longer in good standing.
export function restrictionFromErrorCode(code: unknown): Restriction | null {
  if (code === 'DRIVER_BANNED') return 'banned'
  if (code === 'DRIVER_SUSPENDED') return 'suspended'
  return null
}
