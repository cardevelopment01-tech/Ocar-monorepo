import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Card, colors, radii, spacing, typography } from '@ocar/mobile-shared'
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
  // Call/chat actions live inside this same card, one compact row, matching
  // web's DriverMiniRow -- they used to render as a separate sibling card
  // next to this one, which starved the name column of width and forced
  // "Sujal Kumar Ghosh" onto two lines instead of web's single line.
  rideId: string
  canCall: boolean
  unreadChatCount: number
  onOpenChat: () => void
}

export function DriverCard({ ride, stale, otp, otpLabel, rideId, canCall, unreadChatCount, onOpenChat }: DriverCardProps) {
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
    <Card style={styles.card} accessibilityRole="summary" accessibilityLabel={`Driver ${ride.driverName ?? 'assigned'}`}>
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
          <Text style={styles.name} numberOfLines={1}>{ride.driverName ?? 'Your driver'}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {ride.driverRating ? `★ ${ride.driverRating}` : 'New'} · {vehicleLine} · {ride.vehicleNumberPlate ?? '—'}
          </Text>
        </View>
        <View style={styles.actions}>
          {canCall ? (
            <Pressable onPress={() => void handleCall()} disabled={calling} style={styles.actionBtn} accessibilityLabel="Call driver">
              <Feather name="phone" size={15} color={colors.primary} />
            </Pressable>
          ) : null}
          <Pressable onPress={onOpenChat} style={styles.actionBtn} accessibilityLabel="Message driver">
            <Feather name="message-circle" size={15} color={colors.primary} />
            {unreadChatCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadChatCount > 9 ? '9+' : unreadChatCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
      {otp ? (
        <View style={styles.pinRow} accessibilityLabel={`${otpLabel ?? 'PIN'}: ${otp.split('').join(' ')}`}>
          <Text style={styles.pinLabel}>{otpLabel ?? 'PIN'}</Text>
          <Text style={styles.pinDigits} maxFontSizeMultiplier={2}>{otp}</Text>
        </View>
      ) : null}
      {stale ? (
        <Text style={styles.staleNote} accessibilityLiveRegion="polite">
          Driver's location hasn't updated in a few minutes
        </Text>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  photo: { width: 44, height: 44, borderRadius: 22, flexShrink: 0 },
  photoFallback: { backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  photoInitial: { ...typography.title, color: colors.primary },
  info: { flex: 1, minWidth: 0, gap: 1 },
  name: { ...typography.label, fontSize: 15, fontWeight: '700', color: colors.ink900 },
  meta: { ...typography.caption, color: colors.ink600 },
  actions: { flexDirection: 'row', gap: spacing.xs, flexShrink: 0 },
  actionBtn: { width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 14, height: 14, paddingHorizontal: 3, borderRadius: 7, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 8, fontWeight: '700', color: colors.inkInverse },
  callError: { ...typography.caption, color: colors.error },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primarySubtle,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
  },
  pinLabel: { ...typography.caption, color: colors.primaryDark, fontWeight: '700', textTransform: 'uppercase', fontSize: 10 },
  pinDigits: {
    fontFamily: typography.display.fontFamily,
    fontWeight: typography.display.fontWeight,
    fontSize: 20,
    letterSpacing: 3,
    color: colors.ink900,
  },
  staleNote: { ...typography.caption, color: colors.warning },
})
