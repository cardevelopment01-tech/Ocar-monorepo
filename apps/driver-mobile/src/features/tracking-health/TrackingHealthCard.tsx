import { Linking, Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, PulseDot, spacing, Text, typography } from '@ocar/mobile-shared'
import { ISSUE_COPY, type TrackingAction, type TrackingIssue } from './trackingHealth'

type Props = {
  issue: TrackingIssue | null
  recovered: boolean
  /** Runs the Restart action (the card handles the two Settings actions itself). */
  onRestart: () => void
  /** Called after the driver is sent to Settings; the app re-reads state when they come back. */
  onOpenedSettings?: () => void
}

function run(action: TrackingAction, onRestart: () => void, onOpenedSettings?: () => void): void {
  if (action === 'restart') { onRestart(); return }
  onOpenedSettings?.()
  if (action === 'location_settings') Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => { void Linking.openSettings() })
  else void Linking.openSettings()
}

/** One calm card for everything that can stop the phone reporting the driver's location: what is wrong, why it matters (ride requests),
 *  and the single tap that fixes it. Eases in and out, and shows a brief "back" confirmation once it is fixed. */
export function TrackingHealthCard({ issue, recovered, onRestart, onOpenedSettings }: Props) {
  if (!issue && !recovered) return null
  const entering = FadeIn.duration(220).reduceMotion(ReduceMotion.System)
  const exiting = FadeOut.duration(160).reduceMotion(ReduceMotion.System)

  if (!issue) {
    return (
      <Animated.View entering={entering} exiting={exiting} style={[styles.card, styles.good]} accessibilityLiveRegion="polite">
        <View style={[styles.icon, { backgroundColor: colors.success }]}><Feather name="check" size={16} color={colors.inkInverse} /></View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.success }]}>Location is back</Text>
          <Text style={styles.message}>You're live and can get ride requests.</Text>
        </View>
      </Animated.View>
    )
  }

  const c = ISSUE_COPY[issue]
  const soft = c.tone === 'info'
  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      style={[styles.card, soft ? styles.soft : styles.warn]}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={`${c.title}. ${c.message}`}
    >
      <View style={[styles.icon, { backgroundColor: soft ? colors.surface3 : colors.error }]}>
        {soft ? <PulseDot color={colors.ink600} size={8} /> : <Feather name="map-pin" size={16} color={colors.inkInverse} />}
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, soft ? null : { color: colors.error }]}>{c.title}</Text>
        <Text style={styles.message}>{c.message}</Text>
      </View>
      {c.action ? (
        <Pressable
          onPress={() => run(c.action!, onRestart, onOpenedSettings)}
          accessibilityRole="button"
          accessibilityLabel={c.actionLabel}
          hitSlop={8}
          style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
        >
          <Text style={styles.actionText}>{c.actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: 20, borderWidth: 1, padding: spacing.md },
  warn: { backgroundColor: colors.errorLight, borderColor: colors.error },
  soft: { backgroundColor: colors.surface, borderColor: colors.border },
  good: { backgroundColor: colors.successLight, borderColor: colors.success },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  title: { ...typography.label, fontFamily: fonts.bold, fontSize: 14, color: colors.ink900 },
  message: { ...typography.caption, color: colors.ink600 },
  action: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.error },
  actionText: { ...typography.caption, fontFamily: fonts.bold, color: colors.inkInverse },
  pressed: { transform: [{ scale: 0.96 }] },
})
