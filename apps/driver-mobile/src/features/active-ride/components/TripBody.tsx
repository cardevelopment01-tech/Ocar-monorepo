import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, radii, spacing, typography, Text } from '@ocar/mobile-shared'
import type { RideStop } from '@ocar/mobile-shared'
import { RiderActionsRow } from './RiderActionsRow'
import { StopTimeline } from './StopTimeline'
import { StopCard } from './StopCard'

export type TripBodyProps = {
  rideId: string
  riderName?: string | null
  navigateTo: [number, number]
  unreadChatCount: number
  onOpenChat: () => void
  actionError: string | null
  headline: string
  badge?: ReactNode
  destinationLabel: string
  stops: RideStop[]
  pendingStop: RideStop | null
  onStopResolved: () => void
  /** Rendered in place of the pending-stop resolver once no stop blocks the trip. */
  primaryAction: ReactNode
}

// Shared shell for the 'in_progress' and 'returning' RideSheet branches --
// previously ~90% duplicated JSX (same RiderActionsRow/headline/detail/
// StopTimeline/pendingStop-gate in both), which the screen's own comment
// already flagged as the exact failure class that bit it once before (a
// fix applied to one branch and silently missed in the other). Only what
// genuinely differs between in_progress and returning -- headline, badge,
// destination label, and the non-pendingStop primary action (start-return
// vs end-otp-only) -- is left to the caller (code-review finding, 2026-09-22).
export function TripBody({
  rideId,
  riderName,
  navigateTo,
  unreadChatCount,
  onOpenChat,
  actionError,
  headline,
  badge,
  destinationLabel,
  stops,
  pendingStop,
  onStopResolved,
  primaryAction,
}: TripBodyProps) {
  return (
    <>
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      <RiderActionsRow rideId={rideId} riderName={riderName ?? null} navigateTo={navigateTo} unreadChatCount={unreadChatCount} onOpenChat={onOpenChat} />
      <View style={styles.headlineRow}>
        <Text style={styles.headline}>{headline}</Text>
        {badge}
      </View>
      <Text style={styles.detail} numberOfLines={2}>
        → {destinationLabel}
      </Text>
      {/* Persistent chrome (Stage 4 stacking priority, hardening design doc):
          the full stop plan, not just whichever one is currently blocking
          end-otp. */}
      <StopTimeline stops={stops} />
      {/* key is required here (unlike RideSheet, which must never have one --
          see its own comment) -- the pending-stop resolver and the caller's
          primaryAction are different element types/props at this same tree
          position, and React reconciles same-type siblings across renders as
          the SAME instance by default. Without a key, a later card can
          inherit an earlier card's leftover local state (this bit
          driver-mobile once already: the end-otp card inheriting the
          start-otp card's typed digits across the driver_arrived ->
          in_progress transition and firing a stale OTP). */}
      {/* The backend hard-blocks end-otp (409 RIDE_HAS_PENDING_STOPS) while
          any stop is still pending -- this app had no way to ever resolve a
          rider-added stop, so a driver who got one added was permanently
          stuck seeing a generic "Could not confirm" error on the end-OTP
          card with no indication why. Show the actual blocking action
          instead until it's resolved. */}
      {pendingStop ? (
        <StopCard
          key={`stop-${pendingStop.sequence}`}
          rideId={rideId}
          sequence={pendingStop.sequence}
          address={pendingStop.address}
          onResolved={onStopResolved}
        />
      ) : (
        primaryAction
      )}
    </>
  )
}

const styles = StyleSheet.create({
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  headline: { ...typography.headline, color: colors.ink900 },
  detail: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error, backgroundColor: colors.errorLight, borderRadius: radii.md, padding: spacing.sm, overflow: 'hidden' },
})
