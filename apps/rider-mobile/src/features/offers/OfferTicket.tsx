import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, { Easing, FadeIn, ReduceMotion, ZoomIn } from 'react-native-reanimated'
import { colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'

// One visual for every offer in the rider app: a small ticket. A round badge on the left, a dashed perforation, the code
// and what it does on the right, and two notches cut into the edges. Three tones:
//   applied   the offer is on this ride (money-green wash, check badge)
//   available an offer the rider can use (teal wash, tag badge)
//   muted     close but not yet eligible (plain, quiet)
// The notches are drawn in the colour of whatever the ticket sits on (`notch`), so it reads as cut-out paper without
// clipping tricks. All text pairs are AA: moneyInk on moneySubtle, ink900/ink600 on the neutral tints.

export type TicketTone = 'applied' | 'available' | 'muted'

const TONES: Record<TicketTone, { bg: string; border: string; badgeBg: string; badgeFg: string; icon: 'check' | 'tag' | 'clock'; code: string }> = {
  applied: { bg: colors.moneySubtle, border: colors.moneyLight, badgeBg: colors.moneyInk, badgeFg: colors.inkInverse, icon: 'check', code: colors.moneyInk },
  available: { bg: colors.primarySubtle, border: colors.primaryLight, badgeBg: colors.primary, badgeFg: colors.inkInverse, icon: 'tag', code: colors.primaryDark },
  muted: { bg: colors.surface2, border: colors.border, badgeBg: colors.borderLight, badgeFg: colors.ink600, icon: 'clock', code: colors.ink600 },
}

type Props = {
  tone: TicketTone
  /** The code (shown as a pill) or, with no code, the offer name. */
  title: string
  /** What it does, or what the rider needs to do. */
  subtitle?: string | undefined
  /** The headline money (e.g. "Save ₹100"); right-aligned under the action. */
  saving?: string | undefined
  /** An action (Remove, Change) or nothing. */
  right?: ReactNode
  /** The colour behind the ticket, for the edge notches. */
  notch: string
  /** Pop in (for the moment an offer gets applied); honours reduce-motion. */
  animateIn?: boolean
  accessibilityLabel?: string | undefined
}

export function OfferTicket({ tone, title, subtitle, saving, right, notch, animateIn, accessibilityLabel }: Props) {
  const t = TONES[tone]
  const body = (
    <View style={[styles.card, { backgroundColor: t.bg, borderColor: t.border }]} accessible={accessibilityLabel !== undefined} accessibilityLabel={accessibilityLabel}>
      <View style={styles.badgeCol}>
        {animateIn ? (
          <Animated.View entering={ZoomIn.duration(220).easing(Easing.bezier(0.23, 1, 0.32, 1)).reduceMotion(ReduceMotion.System)} style={[styles.badge, { backgroundColor: t.badgeBg }]}>
            <Feather name={t.icon} size={16} color={t.badgeFg} />
          </Animated.View>
        ) : (
          <View style={[styles.badge, { backgroundColor: t.badgeBg }]}>
            <Feather name={t.icon} size={16} color={t.badgeFg} />
          </View>
        )}
      </View>
      <View style={[styles.perforation, { borderColor: t.border }]} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: t.code }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {saving || right ? (
        <View style={styles.end}>
          {saving ? <Text style={[styles.saving, { color: tone === 'muted' ? colors.ink600 : colors.moneyInk }]}>{saving}</Text> : null}
          {right}
        </View>
      ) : null}
      {/* Edge notches on the perforation line: two half-discs the colour of the surface behind the ticket. */}
      <View pointerEvents="none" style={[styles.notch, styles.notchTop, { backgroundColor: notch, borderColor: t.border, left: NOTCH_X }]} />
      <View pointerEvents="none" style={[styles.notch, styles.notchBottom, { backgroundColor: notch, borderColor: t.border, left: NOTCH_X }]} />
    </View>
  )
  return animateIn ? <Animated.View entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}>{body}</Animated.View> : body
}

const BADGE = 32
const NOTCH = 12
// The perforation sits after the badge column: padding + badge + gap, centred on its dashed line.
const NOTCH_X = spacing.md + BADGE + spacing.sm - NOTCH / 2

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', minHeight: 64, borderRadius: radii.lg, borderWidth: 1, paddingVertical: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.md },
  badgeCol: { width: BADGE, alignItems: 'center', justifyContent: 'center' },
  badge: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, alignItems: 'center', justifyContent: 'center' },
  perforation: { alignSelf: 'stretch', marginHorizontal: spacing.sm, borderLeftWidth: 1.5, borderStyle: 'dashed' },
  content: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, letterSpacing: 0.6 },
  subtitle: { ...typography.caption, color: colors.ink600 },
  end: { alignItems: 'flex-end', justifyContent: 'center', marginLeft: spacing.sm },
  saving: { ...typography.body, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, borderWidth: 1 },
  notchTop: { top: -NOTCH / 2 - 1 },
  notchBottom: { bottom: -NOTCH / 2 - 1 },
})
