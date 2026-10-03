import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather, FontAwesome } from '@expo/vector-icons'
import { colors, fonts, spacing, typography } from '@ocar/mobile-shared'
import { card } from '@/theme/homeTokens'
import { triggerMaskedCall } from '../api'
import type { RideDetailExtra } from '../types'
import { DriverAvatar, PlateBadge, driverViewFromRide } from './DriverIdentity'

export type DriverCardProps = {
  ride: RideDetailExtra
  stale: boolean
  // Call/chat live inside this card: Uber's "Send a message" + phone row, Rapido's wide "Message <name>".
  rideId: string
  canCall: boolean
  unreadChatCount: number
  onOpenChat: () => void
}

// Who is coming, in the order a rider matches them against the car in front of them: photo + rating,
// name, trips, verified; then "Colour Brand Model" with the number plate. The PIN (PinBand) and pickup
// (MeetAtRow) sit above this card in the ride screen, same order as Uber/Rapido.
export function DriverCard({ ride, stale, rideId, canCall, unreadChatCount, onOpenChat }: DriverCardProps) {
  const view = driverViewFromRide(ride)
  const upgradedTo = ride.bookedCategoryName && ride.assignedCategoryName && ride.bookedCategoryName !== ride.assignedCategoryName
    ? ride.assignedCategoryName : null
  const [calling, setCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  async function handleCall() {
    if (calling || !canCall) return
    setCalling(true)
    setCallError(null)
    try {
      await triggerMaskedCall(rideId)
      // The IVR rings this phone first, then bridges the other party. Hold the button disabled while
      // that happens -- each extra tap re-dials both parties and burns the ride's call cap.
      setCallError('Your phone will ring shortly')
      timers.current.push(setTimeout(() => { setCallError(null); setCalling(false) }, 20000))
    } catch {
      setCallError('Could not connect the call')
      timers.current.push(setTimeout(() => setCallError(null), 4000))
      setCalling(false)
    }
  }

  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel={`Driver ${view.name}`}>
      {callError ? <Text style={styles.callError}>{callError}</Text> : null}

      {/* Row 1: who. Photo left, name block in the middle, rating pill pinned right so no side is empty. */}
      <View style={styles.top}>
        <DriverAvatar view={view} photo={ride.driverPhoto} size="lg" />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>{view.name}</Text>
          <Text style={styles.meta}>{view.tripsText}</Text>
          {view.verified ? (
            <View style={styles.verified}>
              <Feather name="shield" size={12} color={colors.success} />
              <Text style={styles.verifiedText}>Verified driver</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.rating} accessibilityLabel={view.ratingText ? `Rated ${view.ratingText}` : 'New driver'}>
          {view.ratingText ? <FontAwesome name="star" size={12} color={colors.accent} /> : null}
          <Text style={styles.ratingText}>{view.ratingText ?? 'New'}</Text>
        </View>
      </View>

      {/* Row 2: what to look for. One centred panel: the car, then its plate as the hero. */}
      <View style={styles.ride}>
        <Text style={styles.rideLabel}>Your ride</Text>
        <Text style={styles.rideName} numberOfLines={2}>{view.vehicleLine}</Text>
        {upgradedTo ? (
          <View style={styles.upgraded}><Text style={styles.upgradedText}>Upgraded to {upgradedTo}</Text></View>
        ) : null}
        <PlateBadge plate={view.plate} large />
      </View>

      <View style={styles.actions}>
        <Pressable onPress={onOpenChat} style={styles.message} accessibilityRole="button" accessibilityLabel={`Message ${view.firstName}`}>
          <Feather name="message-circle" size={17} color={colors.primary} />
          <Text style={styles.messageText} numberOfLines={1}>Message {view.firstName}</Text>
          {unreadChatCount > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{unreadChatCount > 9 ? '9+' : unreadChatCount}</Text></View>
          ) : null}
        </Pressable>
        {canCall ? (
          <Pressable onPress={() => void handleCall()} disabled={calling} style={[styles.call, calling && styles.busy]} accessibilityRole="button" accessibilityLabel="Call driver">
            <Feather name="phone" size={17} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      {stale ? (
        <Text style={styles.staleNote} accessibilityLiveRegion="polite">Driver's location hasn't updated in a few minutes</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { ...card, padding: spacing.md, gap: 14 },
  top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  info: { flex: 1, minWidth: 0, gap: 2 },
  name: { ...typography.label, fontSize: 18, lineHeight: 24, fontFamily: fonts.bold, color: colors.ink900 },
  meta: { ...typography.caption, color: colors.ink600 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  verifiedText: { fontFamily: fonts.bold, fontSize: 12, color: colors.success },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  ratingText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink900 },
  ride: { alignItems: 'center', gap: 6, backgroundColor: colors.bg, borderRadius: 18, paddingVertical: 14, paddingHorizontal: spacing.md },
  rideLabel: { ...typography.caption, color: colors.ink600 },
  rideName: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink900, textAlign: 'center' },
  upgraded: { alignSelf: 'center', backgroundColor: colors.successLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  upgradedText: { fontFamily: fonts.bold, fontSize: 10, color: colors.success },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  message: { flex: 1, height: 46, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primarySubtle },
  messageText: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink900, flexShrink: 1 },
  call: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  busy: { opacity: 0.5 },
  badge: { position: 'absolute', top: -3, right: 6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontFamily: fonts.bold, color: colors.inkInverse },
  callError: { ...typography.caption, color: colors.error },
  staleNote: { ...typography.caption, color: colors.warning },
})
