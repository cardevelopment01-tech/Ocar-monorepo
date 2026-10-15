import { useEffect } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import Animated, { Easing, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { Button, colors, fonts, radii, shadows, spacing, Text, typography } from '@ocar/mobile-shared'
import type { Restriction } from './accountStanding'

const SUPPORT_EMAIL = 'grievance@ocarindia.com'

type Row = { icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string }

// One screen, two tones. Suspended is calm and hopeful (it can be lifted, here is what to do); banned is plain and
// final but still gives a way to ask for a review. Neither blames, shouts or hides what the driver can do next.
const COPY: Record<Restriction, {
  pill: string
  icon: React.ComponentProps<typeof Feather>['name']
  tone: string
  toneSoft: string
  toneWash: string
  title: string
  body: string
  rows: Row[]
}> = {
  suspended: {
    pill: 'Suspended',
    icon: 'pause-circle',
    tone: colors.warning,
    toneSoft: colors.warningLight,
    toneWash: '#FBF1DF',
    title: 'Your account is on hold',
    body: "Your driver account is temporarily suspended, so you can't go online or receive ride requests. This isn't permanent. Support can tell you what is needed to get you back on the road.",
    rows: [
      { icon: 'power', title: "You're offline", body: 'Going online and new ride requests are paused until the hold is lifted.' },
      { icon: 'message-circle', title: 'Talk to support', body: 'Share your driver code so they can find your account straight away.' },
      { icon: 'refresh-cw', title: 'We will bring you back', body: 'This screen updates by itself. Once your account is active again you land on Home.' },
    ],
  },
  banned: {
    pill: 'Deactivated',
    icon: 'slash',
    tone: colors.error,
    toneSoft: colors.errorLight,
    toneWash: '#FBE4E4',
    title: 'Your account has been deactivated',
    body: 'Your driver account has been permanently deactivated after a violation of our terms, so you can no longer drive on Ocar.',
    rows: [
      { icon: 'slash', title: 'No more ride requests', body: "You can't go online or accept rides with this account." },
      { icon: 'mail', title: 'Think this is a mistake?', body: 'Write to support with your driver code and the team will take another look.' },
    ],
  },
}

// Two soft rings behind the icon breathe slowly; still when the phone asks for reduced motion.
function Halo({ tone, toneSoft, icon }: { tone: string; toneSoft: string; icon: React.ComponentProps<typeof Feather>['name'] }) {
  const reduced = useReducedMotion()
  const breath = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    breath.set(withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }), -1, true))
  }, [reduced, breath])
  const outer = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breath.get() * 0.07 }], opacity: 0.55 - breath.get() * 0.2 }))
  const mid = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breath.get() * 0.035 }] }))
  return (
    <View style={styles.haloWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.ringOuter, { backgroundColor: toneSoft }, outer]} />
      <Animated.View style={[styles.ringMid, { backgroundColor: toneSoft }, mid]} />
      <View style={[styles.iconDisc, shadows.card]}>
        <Feather name={icon} size={34} color={tone} />
      </View>
    </View>
  )
}

export function AccountStatusScreen({
  variant, driverCode, checking, onCheck, onSignOut,
}: {
  variant: Restriction
  driverCode: string | null | undefined
  checking: boolean
  onCheck: () => void
  onSignOut: () => void
}) {
  const insets = useSafeAreaInsets()
  const copy = COPY[variant]
  const subject = encodeURIComponent(driverCode ? `Ocar driver account - ${driverCode}` : 'Ocar driver account')
  const contactSupport = () => {
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}`).catch(() => {})
  }

  return (
    <View style={styles.screen}>
      <LinearGradient colors={[copy.toneWash, colors.bg]} style={styles.wash} pointerEvents="none" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: spacing.lg }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(380)} style={styles.center}>
          <View style={[styles.pill, { backgroundColor: copy.toneSoft }]}>
            <View style={[styles.pillDot, { backgroundColor: copy.tone }]} />
            <Text style={[styles.pillText, { color: copy.tone }]}>{copy.pill}</Text>
          </View>
          <Halo tone={copy.tone} toneSoft={copy.toneSoft} icon={copy.icon} />
          <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          {driverCode ? (
            <View style={styles.codeChip} accessible accessibilityLabel={`Your driver code is ${driverCode.split('').join(' ')}`}>
              <Text style={styles.codeLabel}>DRIVER CODE</Text>
              <View style={styles.codeDivider} />
              <Text style={styles.codeValue} selectable>{driverCode}</Text>
            </View>
          ) : null}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(110).duration(380)} style={styles.card}>
          {copy.rows.map((row, i) => (
            <View key={row.title} style={[styles.row, i > 0 && styles.rowDivider]}>
              <View style={[styles.rowIcon, { backgroundColor: colors.primarySubtle }]}>
                <Feather name={row.icon} size={16} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowBody}>{row.body}</Text>
              </View>
            </View>
          ))}
        </Animated.View>

      </ScrollView>
      <Animated.View entering={FadeInDown.delay(290).duration(380)} style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Button label="Contact support" icon="mail" onPress={contactSupport} />
        <View style={styles.linkRow}>
          {variant === 'suspended' ? (
            <>
              <Pressable onPress={onCheck} disabled={checking} hitSlop={10} accessibilityRole="button" style={styles.link}>
                <Feather name="refresh-cw" size={14} color={colors.primary} />
                <Text style={[styles.linkText, { color: colors.primary }]}>{checking ? 'Checking…' : 'Check status'}</Text>
              </Pressable>
              <View style={styles.linkDot} />
            </>
          ) : null}
          <Pressable onPress={onSignOut} hitSlop={10} accessibilityRole="button" style={styles.link}>
            <Text style={styles.linkText}>Sign out</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  center: { alignItems: 'center', gap: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.full },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  haloWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.sm },
  ringOuter: { position: 'absolute', width: 150, height: 150, borderRadius: 75 },
  ringMid: { position: 'absolute', width: 116, height: 116, borderRadius: 58, opacity: 0.9 },
  iconDisc: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.display, color: colors.ink900, textAlign: 'center', fontFamily: fonts.bold },
  body: { ...typography.body, color: colors.ink600, textAlign: 'center', maxWidth: 340 },
  card: { backgroundColor: colors.surface, borderRadius: radii['2xl'], borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, ...shadows.card },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, alignItems: 'flex-start' },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.title, fontSize: 15, lineHeight: 21, color: colors.ink900 },
  rowBody: { ...typography.caption, fontSize: 13, lineHeight: 19, color: colors.ink600 },
  codeChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, paddingVertical: 8, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  codeLabel: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.1, color: colors.ink400 },
  codeDivider: { width: 1, height: 14, backgroundColor: colors.border },
  codeValue: { fontFamily: fonts.bold, fontSize: 15, letterSpacing: 1.6, color: colors.ink900 },
  footer: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  linkText: { ...typography.label, fontFamily: fonts.semibold, color: colors.ink600 },
  linkDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.ink400 },
})
