import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { triggerMaskedCall } from '../api'

export type RiderActionsRowProps = {
  rideId: string
  riderName?: string | null
  /** [lat, lng] of wherever this leg is headed -- pickup or destination. */
  navigateTo: [number, number]
}

// Driver-side counterpart to rider-mobile's DriverCard + DriverActionsRow --
// the active-ride screen previously showed zero rider info (name, call) until
// the end-of-trip rating sheet, and had no way to open turn-by-turn
// navigation at all. Matches web driver app's NavigateToPickup.tsx: masked
// call (same /rides/:id/call endpoint, bidirectional) + a Google Maps deep
// link for navigation (openMapsNav in apps/driver/src/lib/utils.ts).
export function RiderActionsRow({ rideId, riderName, navigateTo }: RiderActionsRowProps) {
  const [calling, setCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)

  async function handleCall() {
    if (calling) return
    setCalling(true)
    setCallError(null)
    try {
      await triggerMaskedCall(rideId)
    } catch {
      setCallError('Could not connect the call')
      setTimeout(() => setCallError(null), 4000)
    } finally {
      setCalling(false)
    }
  }

  function handleNavigate() {
    const [lat, lng] = navigateTo
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`)
  }

  return (
    <View style={styles.row}>
      {callError ? <Text style={styles.error}>{callError}</Text> : null}
      <View style={styles.riderInfo}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{(riderName ?? '?').charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.riderName} numberOfLines={1}>{riderName ?? 'Your rider'}</Text>
      </View>
      <Pressable onPress={() => void handleCall()} disabled={calling} style={styles.btn} accessibilityLabel="Call rider">
        <Feather name="phone" size={16} color={colors.primary} />
      </Pressable>
      <Pressable onPress={handleNavigate} style={styles.navigateBtn} accessibilityLabel="Navigate">
        <Feather name="navigation" size={15} color={colors.inkInverse} />
        <Text style={styles.navigateText}>Navigate</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  riderInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, flex: 1, minWidth: 0 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...typography.body, color: colors.primary, fontWeight: '700' },
  riderName: { ...typography.body, color: colors.ink900, fontWeight: '600', flexShrink: 1 },
  btn: { width: 40, height: 40, borderRadius: radii.lg, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  navigateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: spacing.sm + 4, borderRadius: radii.lg, backgroundColor: colors.primary },
  navigateText: { ...typography.label, color: colors.inkInverse, fontWeight: '700' },
  error: { position: 'absolute', top: -28, right: 0, ...typography.caption, color: colors.error, backgroundColor: colors.errorLight, paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.sm },
})
