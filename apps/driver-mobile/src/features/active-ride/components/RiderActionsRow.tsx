import { useState } from 'react'
import { Linking, Platform, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { colors, gradientPrimary, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { triggerMaskedCall } from '../api'
import { PressableScale } from './PressableScale'

export type RiderActionsRowProps = {
  rideId: string
  riderName?: string | null
  /** [lat, lng] of wherever this leg is headed -- pickup or destination. */
  navigateTo: [number, number]
  unreadChatCount?: number
  onOpenChat?: () => void
  /** When provided, "Navigate" opens the in-app guided map instead of deep-linking
      to the external Maps app -- see driver-mobile-nav-mode-design.md. */
  onNavigate?: () => void
}

// Driver-side counterpart to rider-mobile's DriverCard + DriverActionsRow: who the
// rider is, a masked call (same /rides/:id/call endpoint, bidirectional), chat, and
// navigation. Rider identity + the two person-actions share one row (call and chat are
// about the rider, so they sit with them); Navigate is about the route, so it gets its
// own full-width tonal button -- tonal, because the solid teal button on this sheet is
// reserved for the one action that commits the trip forward.
export function RiderActionsRow({ rideId, riderName, navigateTo, unreadChatCount = 0, onOpenChat, onNavigate }: RiderActionsRowProps) {
  const [calling, setCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)
  const [callNote, setCallNote] = useState<string | null>(null)

  async function handleCall() {
    if (calling) return
    setCalling(true)
    setCallError(null)
    try {
      await triggerMaskedCall(rideId)
      // The IVR rings this phone first, then bridges the other party. Hold
      // the button disabled while that happens -- each extra tap re-dials
      // both parties and burns the ride's call cap.
      setCallNote('Your phone will ring shortly')
      setTimeout(() => {
        setCallNote(null)
        setCalling(false)
      }, 20000)
    } catch {
      setCallError('Could not connect the call')
      setTimeout(() => setCallError(null), 4000)
      setCalling(false)
    }
  }

  // Native deep-link schemes skip Google Maps' address-confirm screen and drop the
  // driver straight into turn-by-turn -- the plain web directions URL (previous
  // behavior) requires one extra "Start" tap on Maps' side. canOpenURL for
  // comgooglemaps:// on iOS only resolves true if LSApplicationQueriesSchemes lists
  // it (app.json) -- without that entry iOS always reports the app as absent.
  async function handleNavigate() {
    const [lat, lng] = navigateTo
    const nativeUrl =
      Platform.OS === 'android'
        ? `google.navigation:q=${lat},${lng}&mode=d`
        : `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    try {
      if (await Linking.canOpenURL(nativeUrl)) {
        await Linking.openURL(nativeUrl)
        return
      }
    } catch {
      // fall through to the universal web link below
    }
    Linking.openURL(webUrl)
  }

  const status = callError ?? callNote
  return (
    <View style={styles.wrap}>
      <View style={styles.riderRow}>
        <LinearGradient colors={gradientPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
          {riderName ? (
            <Text style={styles.avatarInitial}>{riderName.charAt(0).toUpperCase()}</Text>
          ) : (
            <Feather name="user" size={20} color={colors.inkInverse} />
          )}
        </LinearGradient>
        <View style={styles.riderText}>
          <Text style={styles.riderName} numberOfLines={1}>{riderName ?? 'Your rider'}</Text>
          <Text style={[styles.riderSub, callError ? styles.riderSubError : null]} numberOfLines={1} accessibilityLiveRegion="polite">
            {status ?? 'Calls are private'}
          </Text>
        </View>
        <PressableScale
          onPress={() => void handleCall()}
          disabled={calling}
          style={[styles.round, calling ? styles.roundBusy : null]}
          accessibilityRole="button"
          accessibilityLabel="Call rider"
        >
          <Feather name="phone" size={19} color={colors.primary} />
        </PressableScale>
        {onOpenChat ? (
          <PressableScale onPress={onOpenChat} style={styles.round} accessibilityRole="button" accessibilityLabel={unreadChatCount > 0 ? `Message rider, ${unreadChatCount} unread` : 'Message rider'}>
            <Feather name="message-circle" size={19} color={colors.primary} />
            {unreadChatCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadChatCount > 9 ? '9+' : unreadChatCount}</Text>
              </View>
            ) : null}
          </PressableScale>
        ) : null}
      </View>

      <PressableScale
        onPress={() => (onNavigate ? onNavigate() : void handleNavigate())}
        style={styles.navigateBtn}
        accessibilityRole="button"
        accessibilityLabel="Navigate"
      >
        <Feather name="navigation" size={17} color={colors.primary} />
        <Text style={styles.navigateText}>Navigate</Text>
      </PressableScale>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md - 4 },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  avatarInitial: { ...typography.title, color: colors.inkInverse, fontFamily: fonts.bold },
  riderText: { flex: 1, minWidth: 0, marginLeft: spacing.xs },
  riderName: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, lineHeight: 22 },
  riderSub: { ...typography.label, color: colors.ink600 },
  riderSubError: { color: colors.error },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySubtle },
  roundBusy: { opacity: 0.5 },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.error, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, lineHeight: 12, fontFamily: fonts.bold, color: colors.inkInverse },
  navigateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 48, borderRadius: radii.lg, backgroundColor: colors.primarySubtle },
  navigateText: { ...typography.body, color: colors.primary, fontFamily: fonts.bold, lineHeight: 20 },
})
