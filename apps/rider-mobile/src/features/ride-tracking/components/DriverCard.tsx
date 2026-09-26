import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, spacing, typography } from '@ocar/mobile-shared'
import { card } from '@/theme/homeTokens'
import { triggerMaskedCall } from '../api'
import type { RideDetailExtra } from '../types'

export type DriverCardProps = {
  ride: RideDetailExtra
  stale: boolean
  // Fused into this card, not a separate one elsewhere on the page -- this is
  // the one piece of UI a rider reads aloud to a stranger at their car
  // window, under time pressure. It belongs in the same glance as "is this
  // my driver", not buried mid-scroll past the fare row (Uber's own
  // placement: the PIN sits on the driver row itself).
  otp?: string | null
  otpLabel?: string
  // One line telling the rider when to share the code; the end code must not be given early.
  otpHint?: string
  // Call/chat actions live inside this same card, one compact row, matching
  // web's DriverMiniRow.
  rideId: string
  canCall: boolean
  unreadChatCount: number
  onOpenChat: () => void
}

// Driver card, ride-app style: photo, name + rating chip, vehicle, then a strip with the number plate
// (the thing you actually match against the car in front of you) and the PIN as separate digit boxes.
export function DriverCard({ ride, stale, otp, otpLabel, otpHint, rideId, canCall, unreadChatCount, onOpenChat }: DriverCardProps) {
  const vehicleLine = [ride.vehicleBrand, ride.vehicleModel].filter(Boolean).join(' ') || ride.vehicleName || 'Vehicle'
  const [calling, setCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)

  async function handleCall() {
    if (calling || !canCall) return
    setCalling(true)
    setCallError(null)
    try {
      await triggerMaskedCall(rideId)
      // The IVR rings this phone first, then bridges the other party. Hold
      // the button disabled while that happens -- each extra tap re-dials
      // both parties and burns the ride's call cap.
      setCallError('Your phone will ring shortly')
      setTimeout(() => {
        setCallError(null)
        setCalling(false)
      }, 20000)
    } catch {
      setCallError('Could not connect the call')
      setTimeout(() => setCallError(null), 4000)
      setCalling(false)
    }
  }

  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel={`Driver ${ride.driverName ?? 'assigned'}`}>
      {callError ? <Text style={styles.callError}>{callError}</Text> : null}
      <View style={styles.row}>
        {ride.driverPhoto ? (
          <Image source={{ uri: ride.driverPhoto }} style={styles.photo} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <Text style={styles.photoInitial}>{(ride.driverName ?? '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{ride.driverName ?? 'Your driver'}</Text>
            {ride.driverRating ? (
              <View style={styles.rating}>
                <Feather name="star" size={10} color={colors.accent} />
                <Text style={styles.ratingText}>{ride.driverRating}</Text>
              </View>
            ) : (
              <View style={styles.rating}>
                <Text style={styles.ratingText}>New</Text>
              </View>
            )}
          </View>
          <Text style={styles.meta} numberOfLines={1}>{vehicleLine}</Text>
        </View>
        <View style={styles.actions}>
          {canCall ? (
            <Pressable onPress={() => void handleCall()} disabled={calling} style={[styles.actionBtn, calling && styles.actionBusy]} accessibilityLabel="Call driver">
              <Feather name="phone" size={17} color={colors.primary} />
            </Pressable>
          ) : null}
          <Pressable onPress={onOpenChat} style={styles.actionBtn} accessibilityLabel="Message driver">
            <Feather name="message-circle" size={17} color={colors.primary} />
            {unreadChatCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadChatCount > 9 ? '9+' : unreadChatCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.strip}>
        <View style={styles.plate} accessibilityLabel={`Number plate ${ride.vehicleNumberPlate ?? 'unknown'}`}>
          <Text style={styles.plateText} numberOfLines={1}>{ride.vehicleNumberPlate ?? '-'}</Text>
        </View>
      </View>

      {otp ? (
        <View style={styles.pin} accessibilityLabel={`${otpLabel ?? 'OTP'}: ${otp.split('').join(' ')}. ${otpHint ?? ''}`}>
          <View style={styles.pinText}>
            <Text style={styles.pinLabel}>{otpLabel ?? 'OTP'}</Text>
            {otpHint ? <Text style={styles.pinHint}>{otpHint}</Text> : null}
          </View>
          <View style={styles.pinBoxes}>
            {otp.split('').map((d, i) => (
              <View key={i} style={styles.pinBox}>
                <Text style={styles.pinDigit} maxFontSizeMultiplier={1.4}>{d}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {stale ? (
        <Text style={styles.staleNote} accessibilityLiveRegion="polite">
          Driver's location hasn't updated in a few minutes
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { ...card, padding: spacing.md, gap: 14 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 52, height: 52, borderRadius: 26, flexShrink: 0, borderWidth: 2, borderColor: colors.surface },
  photoFallback: { backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  photoInitial: { ...typography.title, color: colors.primary },
  info: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { ...typography.label, fontSize: 16, fontFamily: fonts.bold, color: colors.ink900, flexShrink: 1 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.accentLight, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  ratingText: { fontFamily: fonts.bold, fontSize: 11, color: '#8A6420' },
  meta: { ...typography.caption, color: colors.ink600 },
  actions: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  actionBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  actionBusy: { opacity: 0.5 },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 9, fontFamily: fonts.bold, color: colors.inkInverse },
  callError: { ...typography.caption, color: colors.error },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // registration-plate look: bordered, heavy, tracked
  plate: { flexShrink: 1, borderWidth: 1.5, borderColor: colors.ink900, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.surface2 },
  plateText: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 1.2, color: colors.ink900 },
  pin: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.primarySubtle, borderWidth: 1, borderColor: colors.primaryLight, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  pinText: { flex: 1, minWidth: 0, gap: 3 },
  pinLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.primaryDark },
  pinHint: { ...typography.caption, color: colors.ink600 },
  pinBoxes: { flexDirection: 'row', gap: 6 },
  pinBox: { width: 38, height: 46, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  pinDigit: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink900 },
  staleNote: { ...typography.caption, color: colors.warning },
})
