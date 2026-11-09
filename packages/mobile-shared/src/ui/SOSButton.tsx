import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, radii, shadows, spacing, typography, fonts } from '../theme/tokens'
import { font, h } from '../theme/brand'
import type { SOSTriggerResult } from '../api/types'

export type { SOSTriggerResult } from '../api/types'

export type SOSButtonProps = {
  enabled: boolean
  onTrigger: () => Promise<SOSTriggerResult>
  // India's unified emergency number. Always offered in the sheet, never only after a failure.
  emergencyPhoneNumber?: string | null
  // 'bottom-right' matches rider-mobile's tracking screen, which has no persistent full-width
  // bottom button to collide with. Active-ride screens that dock a full-width primary CTA to the
  // bottom (driver-mobile) need 'top-right'.
  anchor?: 'top-right' | 'bottom-right'
  /** Distance from the anchored edge, overriding the default (safe-area top / spacing.xl bottom). */
  offset?: number
  /** 'redesign' = the rider app's 48px gradient button, looping ring and "Emergency help" sheet. Default keeps the original look (driver app). */
  look?: 'redesign'
  /** Redesign look only: when set, the sheet offers "Share live trip with contacts" and calls this (after closing the sheet). */
  onShareTrip?: () => void
}

type Phase = 'idle' | 'sending' | 'sent' | 'error' | 'rate_limited'

const HOLD_MS = 1200
const DEFAULT_EMERGENCY_NUMBER = '112'
const OPEN_LABEL = 'Emergency SOS, double tap for safety options'

/**
 * The floating SOS button. Tapping it opens a safety sheet instead of sending straight away, so a
 * stray touch cannot page the safety team. The alert is sent by holding the red button for about a
 * second; calling the emergency number is one tap and always available.
 */
export function SOSButton({ enabled, onTrigger, emergencyPhoneNumber, anchor = 'bottom-right', offset, look, onShareTrip }: SOSButtonProps) {
  const rd = look === 'redesign'
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const fill = useSharedValue(0)
  const sending = useRef(false)
  const number = emergencyPhoneNumber || DEFAULT_EMERGENCY_NUMBER
  // scaleX from the left edge, not `width`: no layout pass per frame during the 1.2s hold.
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.get() }] }))
  // Redesign only: a soft ring that expands and fades around the button, looping.
  const pulse = useSharedValue(0)
  useEffect(() => {
    if (!rd) return
    pulse.set(withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false))
  }, [rd, pulse])
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - pulse.get()), transform: [{ scale: 1 + 0.7 * pulse.get() }] }))

  useEffect(() => {
    if (!open) {
      setPhase('idle')
      fill.set(0)
    }
  }, [open, fill])

  if (!enabled) return null

  async function send() {
    if (sending.current) return
    sending.current = true
    setPhase('sending')
    try {
      let result = await onTrigger()
      // One automatic retry for a plain error, never for a rate limit.
      if (!result.ok && result.reason === 'error') result = await onTrigger()
      setPhase(result.ok ? 'sent' : result.reason === 'rate_limited' ? 'rate_limited' : 'error')
    } finally {
      sending.current = false
      fill.set(withTiming(0, { duration: 150 }))
    }
  }

  function call() {
    void Linking.openURL(`tel:${number}`)
  }

  const anchorStyle = anchor === 'top-right' ? { top: offset ?? insets.top + spacing.md } : { bottom: offset ?? spacing.xl }
  const busy = phase === 'sending'
  const canHold = phase === 'idle' || phase === 'error'

  return (
    <>
      <View style={[styles.wrap, anchorStyle]} pointerEvents="box-none">
        {rd ? (
          <Pressable
            onPress={() => setOpen(true)}
            hitSlop={8}
            accessible
            accessibilityLabel={OPEN_LABEL}
            accessibilityRole="button"
            style={({ pressed }) => [styles.rdBox, pressed ? styles.pressed : null]}
          >
            <Animated.View pointerEvents="none" style={[styles.rdRing, ringStyle]} />
            <LinearGradient colors={['#EE5A5E', h.danger]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rdCircle}>
              <Text style={styles.rdIcon} maxFontSizeMultiplier={1.15}>SOS</Text>
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setOpen(true)}
            hitSlop={8}
            accessible
            accessibilityLabel={OPEN_LABEL}
            accessibilityRole="button"
            style={({ pressed }) => [styles.circle, pressed ? styles.pressed : null]}
          >
            {/* Fixed 56px circle: uncapped, the system font scale pushes "SOS" out of it. */}
            <Text style={styles.icon} maxFontSizeMultiplier={1.15}>SOS</Text>
          </Pressable>
        )}
      </View>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => !busy && setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.scrim} onPress={() => !busy && setOpen(false)} accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.handle} />

            {phase === 'sent' ? (
              <View style={styles.block}>
                <View style={styles.sentBadge}><Feather name="check" size={26} color={colors.success} /></View>
                <Text style={styles.title}>Alert sent</Text>
                <Text style={styles.body}>The Ocar safety team has your live location and will follow up. If you are in danger, call {number} now.</Text>
              </View>
            ) : rd ? (
              <View style={styles.rdHead}>
                <View style={styles.rdShield}><Feather name="shield" size={24} color={h.danger} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rdTitle}>Emergency help</Text>
                  <Text style={styles.rdSub}>Your live location and trip details are shared when you alert.</Text>
                </View>
              </View>
            ) : (
              <View style={styles.block}>
                <Text style={styles.title}>Need help?</Text>
                <Text style={styles.body}>Send an alert to the Ocar safety team with your live location, or call the emergency number.</Text>
              </View>
            )}

            {phase === 'error' ? <Text style={styles.error} accessibilityLiveRegion="polite">The alert was not sent. Hold the button to try again, or call {number}.</Text> : null}
            {phase === 'rate_limited' ? <Text style={styles.error} accessibilityLiveRegion="polite">Too many alerts sent. Call {number} or contact support if this is urgent.</Text> : null}

            {rd ? (
              <Pressable onPress={call} accessibilityRole="button" accessibilityLabel={`Call ${number}`} style={({ pressed }) => [pressed ? styles.pressed : null]}>
                <LinearGradient colors={['#EE5A5E', h.danger]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rdCall}>
                  <Feather name="phone" size={18} color="#FFFFFF" />
                  <Text style={styles.rdCallText}>Call emergency services ({number})</Text>
                </LinearGradient>
              </Pressable>
            ) : null}

            {phase !== 'sent' && phase !== 'rate_limited' ? (
              <Pressable
                delayLongPress={HOLD_MS}
                disabled={!canHold}
                onPressIn={() => fill.set(withTiming(1, { duration: HOLD_MS, easing: Easing.linear }))}
                onPressOut={() => { if (!sending.current) fill.set(withTiming(0, { duration: 150 })) }}
                onLongPress={() => void send()}
                accessibilityRole="button"
                accessibilityLabel="Send SOS alert, press and hold"
                accessibilityActions={[{ name: 'activate', label: 'Send SOS alert' }]}
                onAccessibilityAction={() => void send()}
                style={rd ? styles.rdHold : styles.hold}
              >
                <Animated.View style={[rd ? styles.rdHoldFill : styles.holdFill, fillStyle]} pointerEvents="none" />
                <View style={styles.holdRow} pointerEvents="none">
                  {busy ? <ActivityIndicator color={rd ? h.danger : colors.inkInverse} testID="sos-sending-indicator" /> : <Feather name="alert-triangle" size={20} color={rd ? h.danger : colors.inkInverse} />}
                  <Text style={[styles.holdText, rd ? { color: h.danger, fontSize: 15 } : null]}>
                    {busy ? 'Sending alert' : phase === 'error' ? 'Hold to try again' : rd ? 'Hold to alert Ocar safety team' : 'Hold to send alert'}
                  </Text>
                </View>
              </Pressable>
            ) : null}

            {rd && onShareTrip && phase !== 'sent' ? (
              <Pressable
                onPress={() => { if (busy) return; setOpen(false); setTimeout(onShareTrip, 260) }}
                accessibilityRole="button"
                accessibilityLabel="Share live trip with contacts"
                style={({ pressed }) => [styles.rdShare, pressed ? styles.pressed : null]}
              >
                <Text style={styles.rdShareText}>Share live trip with contacts</Text>
              </Pressable>
            ) : null}

            {!rd ? (
              <Pressable onPress={call} accessibilityRole="button" accessibilityLabel={`Call ${number}`} style={({ pressed }) => [styles.call, pressed ? styles.callPressed : null]}>
                <Feather name="phone" size={18} color={colors.error} />
                <Text style={styles.callText}>Call {number}</Text>
              </Pressable>
            ) : null}

            <Pressable onPress={() => !busy && setOpen(false)} accessibilityRole="button" style={styles.close} hitSlop={8}>
              <Text style={[styles.closeText, rd ? styles.rdCloseText : null]}>{phase === 'sent' ? 'Done' : rd ? 'I am safe, close' : 'Cancel'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: spacing.md, zIndex: 10, alignItems: 'flex-end', gap: spacing.xs },
  circle: { width: 56, height: 56, borderRadius: radii.full, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center', ...shadows.buttonPrimary },
  pressed: { transform: [{ scale: 0.96 }] },
  icon: { ...typography.label, color: colors.inkInverse, fontFamily: fonts.bold },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(12,20,22,0.5)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, maxHeight: '96%' },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.xs },
  block: { gap: 6, alignItems: 'flex-start' },
  sentBadge: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.ink900 },
  body: { ...typography.body, color: colors.ink600 },
  error: { ...typography.caption, color: colors.error },
  hold: { height: 60, borderRadius: radii.xl, backgroundColor: colors.error, overflow: 'hidden', justifyContent: 'center', marginTop: spacing.xs },
  holdFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, transformOrigin: 'left', backgroundColor: 'rgba(0,0,0,0.28)' },
  holdRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  holdText: { ...typography.label, fontFamily: fonts.bold, color: colors.inkInverse },
  call: { height: 52, borderRadius: radii.xl, borderWidth: 1.5, borderColor: colors.error, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  callPressed: { backgroundColor: colors.errorLight },
  callText: { ...typography.label, fontFamily: fonts.bold, color: colors.error },
  close: { alignItems: 'center', paddingVertical: spacing.sm },
  closeText: { ...typography.label, color: colors.ink600 },
  // ---- redesign look (rider app) ----
  rdBox: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  rdRing: { position: 'absolute', width: 48, height: 48, borderRadius: 24, backgroundColor: '#E5484D' },
  rdCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 18px rgba(194,59,59,0.38)' },
  rdIcon: { fontFamily: font.xb, fontSize: 13, letterSpacing: 0.6, color: '#FFFFFF' },
  rdHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  rdShield: { width: 52, height: 52, borderRadius: 26, backgroundColor: h.dangerWash, alignItems: 'center', justifyContent: 'center' },
  rdTitle: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory, marginBottom: 3 },
  rdSub: { fontFamily: font.r, fontSize: 13.5, lineHeight: 19, color: h.muted },
  rdCall: { height: 56, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 12px 24px rgba(194,59,59,0.3)' },
  rdCallText: { fontFamily: font.b, fontSize: 15.5, color: '#FFFFFF' },
  rdHold: { height: 54, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(194,59,59,0.35)', backgroundColor: '#FFFFFF', overflow: 'hidden', justifyContent: 'center', marginTop: 2 },
  rdHoldFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, transformOrigin: 'left', backgroundColor: 'rgba(194,59,59,0.16)' },
  rdShare: { height: 54, borderRadius: 18, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  rdShareText: { fontFamily: font.b, fontSize: 15, color: h.ivory },
  rdCloseText: { fontFamily: font.sb, fontSize: 14.5, color: h.muted },
})
