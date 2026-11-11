import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { font, h } from '@ocar/mobile-shared'
import { useMaskedCall } from '../useMaskedCall'
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
  const { phase, callError, handleCall } = useMaskedCall(rideId, canCall, view.firstName)

  return (
    <View accessibilityRole="summary" accessibilityLabel={`Driver ${view.name}`}>
      <View style={styles.card}>
        {/* Who: photo with the rating hanging off it, name, trips, plate. */}
        <View style={styles.top}>
          <DriverAvatar view={view} photo={ride.driverPhoto} size="lg" chip />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={2}>{view.name}</Text>
            <Text style={styles.meta} numberOfLines={3}>{view.vehicleLine}{(ride.driverTotalTrips ?? 0) > 0 ? ` · ${view.tripsText}` : ''}</Text>
            {view.verified ? (
              <View style={styles.verified}>
                <Feather name="shield" size={12} color={h.live} />
                <Text style={styles.verifiedText}>Verified driver</Text>
              </View>
            ) : null}
            {upgradedTo ? (
              <View style={styles.upgraded}><Text style={styles.upgradedText}>Upgraded to {upgradedTo}</Text></View>
            ) : null}
            <View style={styles.plateInfo}>
              <PlateBadge plate={view.plate} />
            </View>
          </View>
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
          <Pressable
            onPress={() => void handleCall()}
            disabled={phase !== 'idle'}
            style={[styles.call, phase === 'ringing' ? styles.callRinging : null]}
            accessibilityRole="button"
            accessibilityState={{ disabled: phase !== 'idle', busy: phase === 'connecting' }}
            accessibilityLabel={phase === 'ringing' ? 'Calling you' : phase === 'connecting' ? 'Connecting the call' : 'Call driver'}
          >
            {phase === 'connecting' ? <ActivityIndicator size="small" color={h.ivory} /> : <Feather name={phase === 'ringing' ? 'phone-incoming' : 'phone'} size={18} color={phase === 'ringing' ? h.tealText : h.ivory} />}
            <Text style={[styles.callText, phase === 'ringing' ? { color: h.tealText } : null]} numberOfLines={1}>
              {phase === 'ringing' ? 'Calling you…' : phase === 'connecting' ? 'Connecting…' : 'Call'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {phase === 'ringing' ? (
        <View style={styles.callNote} accessibilityLiveRegion="polite">
          <Feather name="phone-incoming" size={15} color={h.tealText} />
          <Text style={styles.callNoteText}>Pick up our call and we'll connect you to {view.firstName}.</Text>
        </View>
      ) : null}
      {callError ? <Text style={styles.callError} accessibilityLiveRegion="polite">{callError}</Text> : null}

      {stale ? (
        <Text style={styles.staleNote} accessibilityLiveRegion="polite">Driver's location hasn't updated in a few minutes</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#F7F6F1', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(20,23,26,0.05)', padding: 14, gap: 12 },
  top: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingRight: 0 },
  info: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontFamily: font.b, fontSize: 16.5, lineHeight: 22, color: h.ivory },
  meta: { fontFamily: font.m, fontSize: 12.5, color: h.muted },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  verifiedText: { fontFamily: font.b, fontSize: 12, color: h.live },
  upgraded: { alignSelf: 'flex-start', backgroundColor: '#DDF5EA', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  upgradedText: { fontFamily: font.b, fontSize: 11, color: h.live },
  plateInfo: { alignItems: 'flex-start', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  message: { flex: 1.5, height: 50, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: h.tealWash },
  messageText: { fontFamily: font.b, fontSize: 14.5, color: h.tealText, flexShrink: 1 },
  call: { flex: 1, height: 50, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: h.chip },
  callText: { fontFamily: font.sb, fontSize: 14.5, color: h.ivory },
  callRinging: { backgroundColor: h.tealWash },
  callNote: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: h.tealWash, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
  callNoteText: { flex: 1, fontFamily: font.sb, fontSize: 13, lineHeight: 18, color: h.tealText },
  badge: { position: 'absolute', top: -4, right: 8, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: h.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontFamily: font.b, color: '#FFFFFF' },
  callError: { fontFamily: font.m, fontSize: 13, lineHeight: 18, color: h.danger, marginTop: 10 },
  staleNote: { fontFamily: font.m, fontSize: 12.5, color: h.goldInk, marginTop: 8 },
})
