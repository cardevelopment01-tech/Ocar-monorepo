import { Children, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { Button, Text, colors, fonts, shadow, spacing, typography } from '@ocar/mobile-shared'
import { BottomSheet } from '@/features/go-online/components/BottomSheet'

/**
 * How the driver app tells a driver something needs their attention. Home never stacks panels: every notice is a ROW in one grouped panel
 * (the same soft fill and hairline dividers the Earnings block uses), so the sheet keeps its height however many things there are to say.
 * Rows are ordered by priority (blocker, then a booking that needs action, then confirm, then info) and carry their own inline action.
 * One row at a time may grow into a block (an urgent booking); the full explanation of anything else opens in a bottom sheet on tap.
 *
 * Colour lives only in the small dot and pill, never in a fill:
 *   blocker    red     the driver cannot receive rides until this is fixed
 *   attention  amber   something to do soon (confirm, leave by, head out, going live)
 *   info       teal    good to know
 *   ok         green   it worked
 */
export type NoticeTone = 'blocker' | 'attention' | 'info' | 'ok'

// Text colours are the darker shade of each tint's own hue so 12 to 13 px labels clear 4.5:1 on their backgrounds.
export const tonePill: Record<NoticeTone, { bg: string; ink: string; dot: string }> = {
  blocker: { bg: colors.errorLight, ink: '#B4262B', dot: colors.error },
  attention: { bg: colors.warningLight, ink: '#8A6420', dot: colors.warning },
  info: { bg: colors.primarySubtle, ink: colors.primaryDark, dot: colors.primary },
  ok: { bg: colors.successLight, ink: '#13795B', dot: colors.success },
}

const enter = FadeIn.duration(220).reduceMotion(ReduceMotion.System)
const leave = FadeOut.duration(160).reduceMotion(ReduceMotion.System)

/** The grouped panel. Renders nothing when it has no rows, and puts a hairline between the rows it has. */
export function NoticeGroup({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean)
  if (items.length === 0) return null
  return (
    <View style={styles.group} accessibilityLiveRegion="polite">
      {items.map((child, i) => <View key={i} style={i > 0 ? styles.sep : null}>{child}</View>)}
    </View>
  )
}

/** The tinted status pill: a dot and a short bold label (the Return Cab banner's own language). */
export function TonePill({ tone, label }: { tone: NoticeTone; label: string }) {
  const t = tonePill[tone]
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <View style={[styles.pillDot, { backgroundColor: t.dot }]} />
      <Text style={[styles.pillText, { color: t.ink }]}>{label}</Text>
    </View>
  )
}

type RowProps = {
  tone: NoticeTone
  title: string
  /** One line: it truncates, the detail sheet carries the full sentence. */
  message: string
  /** Quiet text on the right when there is no action, e.g. "in 1h 56m". */
  aside?: string
  /** The one thing to do, as a small soft pill. */
  action?: { label: string; onPress: () => void }
  /** Tapping the row (opens the detail sheet, or the booking screen). */
  onPress?: () => void
}

/** One notice: dot, bold title, one quiet line, and either an inline action or a chevron. 64 px, however much there is to say. */
export function NoticeRow({ tone, title, message, aside, action, onPress }: RowProps) {
  const label = `${title}. ${message}${aside ? `. ${aside}` : ''}`
  const body = (
    <>
      <View style={[styles.dot, { backgroundColor: tonePill[tone].dot }]} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.message} numberOfLines={1}>{message}</Text>
      </View>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} hitSlop={8} style={({ pressed }) => [styles.soft, pressed ? styles.pressed : null]}>
          <Text style={styles.softText}>{action.label}</Text>
        </Pressable>
      ) : aside ? (
        <View style={styles.asideRow}>
          <Text style={styles.aside}>{aside}</Text>
          {onPress ? <Feather name="chevron-right" size={16} color={colors.ink600} /> : null}
        </View>
      ) : onPress ? <Feather name="chevron-right" size={18} color={colors.ink600} /> : null}
    </>
  )
  return (
    <Animated.View entering={enter} exiting={leave}>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.row, pressed ? styles.pressedRow : null]}>{body}</Pressable>
      ) : (
        <View style={styles.row} accessible accessibilityLabel={label}>{body}</View>
      )}
    </Animated.View>
  )
}

/** The padded frame for the one row that grows into a block (an urgent booking). */
export function NoticeBlock({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
  return (
    <Animated.View entering={enter} exiting={leave}>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [styles.block, pressed ? styles.pressedRow : null]}>{children}</Pressable>
      ) : (
        <View style={styles.block} accessible={accessibilityLabel != null} accessibilityLabel={accessibilityLabel}>{children}</View>
      )}
    </Animated.View>
  )
}

/** What the bottom sheet says about one notice. */
export type NoticeDetail = {
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  description: string
  /** A short, real sequence (1 to 3 steps); omitted when there is nothing to walk through. */
  steps?: string[]
  ctaLabel: string
  onCta: () => void
}

/** The full explanation, in the app's own bottom-sheet pattern (ring icon, centred title, calm sentence, one clear button, a soft way out). */
export function NoticeSheet({ detail, onClose }: { detail: NoticeDetail | null; onClose: () => void }) {
  return (
    <BottomSheet visible={detail !== null} onClose={onClose}>
      {detail ? (
        <View style={styles.sheetBody}>
          <View style={styles.ring}>
            <View style={styles.ringInner}><Feather name={detail.icon} size={26} color={colors.primary} /></View>
          </View>
          <Text style={styles.sheetTitle} accessibilityRole="header">{detail.title}</Text>
          <Text style={styles.sheetText}>{detail.description}</Text>
          {detail.steps && detail.steps.length > 0 ? (
            <View style={styles.steps}>
              {detail.steps.map((step, i) => (
                <View key={step} style={[styles.step, i > 0 ? styles.sep : null]}>
                  <View style={styles.stepNo}><Text style={styles.stepNoText}>{i + 1}</Text></View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.sheetActions}>
            <Button label={detail.ctaLabel} variant="cta" onPress={() => { detail.onCta(); onClose() }} />
            <Button label="Not now" variant="soft" onPress={onClose} />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  group: { backgroundColor: colors.surface2, borderRadius: 16, overflow: 'hidden' },
  sep: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  pressedRow: { backgroundColor: colors.surface3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingVertical: 13, paddingLeft: spacing.md, paddingRight: 14, minHeight: 64 },
  dot: { width: 8, height: 8, borderRadius: 4, alignSelf: 'flex-start', marginTop: 7 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: { ...typography.label, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.ink900 },
  message: { ...typography.label, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink600 },
  soft: { height: 36, paddingHorizontal: spacing.md, borderRadius: 18, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  softText: { ...typography.label, fontFamily: fonts.bold, fontSize: 13, color: colors.primaryDark },
  asideRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  aside: { ...typography.label, fontFamily: fonts.semibold, fontSize: 13, color: colors.ink600, fontVariant: ['tabular-nums'] },
  block: { paddingTop: 14, paddingBottom: spacing.md, paddingHorizontal: spacing.md, gap: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: spacing.sm + 4, paddingVertical: 5 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { ...typography.caption, fontFamily: fonts.bold },
  // The bottom sheet, one centred column like the app's other sheets.
  sheetBody: { paddingHorizontal: spacing.lg, alignItems: 'center' },
  ring: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  ringInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.sm },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: colors.ink900, textAlign: 'center', marginTop: spacing.lg },
  sheetText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink600, textAlign: 'center', marginTop: spacing.sm, maxWidth: 300 },
  steps: { alignSelf: 'stretch', backgroundColor: colors.surface2, borderRadius: 16, marginTop: spacing.lg - 4, overflow: 'hidden' },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingVertical: 13, paddingHorizontal: spacing.md },
  stepNo: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  stepNoText: { ...typography.caption, fontFamily: fonts.bold, color: colors.primaryDark },
  stepText: { flex: 1, ...typography.label, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink900 },
  sheetActions: { alignSelf: 'stretch', gap: spacing.sm + 2, marginTop: spacing.lg - 4 },
})
