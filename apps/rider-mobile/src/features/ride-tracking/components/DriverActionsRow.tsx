import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { triggerMaskedCall } from '../api'

export type DriverActionsRowProps = {
  rideId: string
  canCall: boolean
  unreadChatCount: number
  onOpenChat: () => void
}

// Mirrors the web tracking page's call/chat buttons in DriverMiniRow -- masked call
// (never the driver's raw number, server bridges via Exotel) + chat entry point with
// an unread badge.
export function DriverActionsRow({ rideId, canCall, unreadChatCount, onOpenChat }: DriverActionsRowProps) {
  const [calling, setCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)

  async function handleCall() {
    if (calling || !canCall) return
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

  return (
    <View style={styles.row}>
      {callError ? <Text style={styles.error}>{callError}</Text> : null}
      {canCall ? (
        <Pressable onPress={handleCall} disabled={calling} style={styles.btn} accessibilityLabel="Call driver">
          <Feather name="phone" size={16} color={colors.primary} />
        </Pressable>
      ) : null}
      <Pressable onPress={onOpenChat} style={styles.btn} accessibilityLabel="Message driver">
        <Feather name="message-circle" size={16} color={colors.primary} />
        {unreadChatCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadChatCount > 9 ? '9+' : unreadChatCount}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, position: 'relative' },
  btn: { width: 44, height: 44, borderRadius: radii.lg, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 9, fontWeight: '700', color: colors.inkInverse },
  error: { position: 'absolute', top: -28, right: 0, ...typography.caption, color: colors.error, backgroundColor: colors.errorLight, paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.sm },
})
