import { useState } from 'react'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { triggerMaskedCall } from '../api'

export type RiderActionsRowProps = {
  rideId: string
  riderName?: string | null
  /** [lat, lng] of wherever this leg is headed -- pickup or destination. */
  navigateTo: [number, number]
  unreadChatCount?: number
  onOpenChat?: () => void
}

// Driver-side counterpart to rider-mobile's DriverCard + DriverActionsRow --
// the active-ride screen previously showed zero rider info (name, call) until
// the end-of-trip rating sheet, and had no way to open turn-by-turn
// navigation at all. Matches web driver app's NavigateToPickup.tsx: masked
// call (same /rides/:id/call endpoint, bidirectional) + a Google Maps deep
// link for navigation (openMapsNav in apps/driver/src/lib/utils.ts).
export function RiderActionsRow({ rideId, riderName, navigateTo, unreadChatCount = 0, onOpenChat }: RiderActionsRowProps) {
  const [calling, setCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)

  async function handleCall() {
    if (calling) return
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

  function handleNavigate() {
    const [lat, lng] = navigateTo
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`)
  }

  return (
    <View style={styles.wrap}>
      {callError ? <Text style={styles.error}>{callError}</Text> : null}
      {/* Rider identity gets its own full-width row -- previously shared one
          row with all three action buttons, which left so little space for
          the name that even the "Your rider" fallback truncated to "Your
          rid...". A name this important shouldn't have to fight buttons for room. */}
      <View style={styles.riderInfo}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{(riderName ?? '?').charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.riderName} numberOfLines={1}>{riderName ?? 'Your rider'}</Text>
      </View>
      <View style={styles.actionsRow}>
        <Pressable onPress={() => void handleCall()} disabled={calling} style={styles.btn} accessibilityLabel="Call rider">
          <Feather name="phone" size={17} color={colors.primary} />
          <Text style={styles.btnLabel}>Call</Text>
        </Pressable>
        {onOpenChat ? (
          <Pressable onPress={onOpenChat} style={styles.btn} accessibilityLabel="Message rider">
            <Feather name="message-circle" size={17} color={colors.primary} />
            <Text style={styles.btnLabel}>Chat</Text>
            {unreadChatCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadChatCount > 9 ? '9+' : unreadChatCount}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        <Pressable onPress={handleNavigate} style={styles.navigateBtn} accessibilityLabel="Navigate">
          <Feather name="navigation" size={16} color={colors.inkInverse} />
          <Text style={styles.navigateText}>Navigate</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  riderInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...typography.body, color: colors.primary, fontFamily: fonts.bold },
  riderName: { ...typography.title, color: colors.ink900, flexShrink: 1 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: radii.lg,
    backgroundColor: colors.primarySubtle,
  },
  btnLabel: { ...typography.label, color: colors.primary, fontFamily: fonts.bold },
  badge: { position: 'absolute', top: 4, right: 10, minWidth: 14, height: 14, paddingHorizontal: 3, borderRadius: 7, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 8, fontFamily: fonts.bold, color: colors.inkInverse },
  navigateBtn: { flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: radii.lg, backgroundColor: colors.primary },
  navigateText: { ...typography.label, color: colors.inkInverse, fontFamily: fonts.bold },
  error: { position: 'absolute', top: -28, right: 0, ...typography.caption, color: colors.error, backgroundColor: colors.errorLight, paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.sm },
})
