import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { font, h, getApiErrorMessage } from '@ocar/mobile-shared'
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
    } catch (err) {
      setCallError(getApiErrorMessage(err, 'Could not connect the call'))
      timers.current.push(setTimeout(() => setCallError(null), 4000))
      setCalling(false)
    }
  }

  return (
    <View accessibilityRole="summary" accessibilityLabel={`Driver ${view.name}`}>
      {callError ? <Text style={styles.callError}>{callError}</Text> : null}

      <View style={styles.card}>
        {/* Who: photo with the rating hanging off it, name, trips, plate. */}
        <View style={styles.top}>
          <DriverAvatar view={view} photo={ride.driverPhoto} size="lg" chip />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={2}>{view.name}</Text>
            <Text style={styles.meta} numberOfLines={2}>{view.vehicleLine}{view.tripsText ? ` · ${view.tripsText}` : ''}</Text>
            {view.verified ? (
              <View style={styles.verified}>
                <Feather name="shield" size={12} color={h.live} />
                <Text style={styles.verifiedText}>Verified driver</Text>
              </View>
            ) : null}
            {upgradedTo ? (
              <View style={styles.upgraded}><Text style={styles.upgradedText}>Upgraded to {upgradedTo}</Text></View>
            ) : null}
          </View>
        </View>
        <View style={styles.plateRow}>
          <PlateBadge plate={view.plate} />
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable onPress={onOpenChat} style={styles.message} accessibilityRole="button" accessibilityLabel={`Message ${view.firstName}`}>
          <Feather name="message-circle" size={18} color={h.tealText} />
          <Text style={styles.messageText} numberOfLines={1}>Message</Text>
          {unreadChatCount > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{unreadChatCount > 9 ? '9+' : unreadChatCount}</Text></View>
          ) : null}
        </Pressable>
        {canCall ? (
          <Pressable onPress={() => void handleCall()} disabled={calling} style={[styles.call, calling && styles.busy]} accessibilityRole="button" accessibilityLabel="Call driver">
            <Feather name="phone" size={18} color={h.ivory} />
            <Text style={styles.callText}>Call</Text>
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
  card: { backgroundColor: '#F7F6F1', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(20,23,26,0.05)', padding: 14, gap: 12 },
  top: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  info: { flex: 1, minWidth: 0, gap: 3, paddingLeft: 4 },
  name: { fontFamily: font.b, fontSize: 16.5, lineHeight: 22, color: h.ivory },
  meta: { fontFamily: font.m, fontSize: 12.5, color: h.muted },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  verifiedText: { fontFamily: font.b, fontSize: 12, color: h.live },
  upgraded: { alignSelf: 'flex-start', backgroundColor: '#DDF5EA', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  upgradedText: { fontFamily: font.b, fontSize: 11, color: h.live },
  plateRow: { alignItems: 'flex-start', paddingLeft: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  message: { flex: 1.5, height: 50, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: h.tealWash },
  messageText: { fontFamily: font.b, fontSize: 14.5, color: h.tealText, flexShrink: 1 },
  call: { flex: 1, height: 50, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: h.chip },
  callText: { fontFamily: font.sb, fontSize: 14.5, color: h.ivory },
  busy: { opacity: 0.5 },
  badge: { position: 'absolute', top: -4, right: 8, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: h.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontFamily: font.b, color: '#FFFFFF' },
  callError: { fontFamily: font.m, fontSize: 12.5, color: h.danger, marginBottom: 6 },
  staleNote: { fontFamily: font.m, fontSize: 12.5, color: h.goldInk, marginTop: 8 },
})
