import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Button, Text, colors, fonts, spacing, typography } from '@ocar/mobile-shared'

/**
 * How the driver app tells a driver something needs their attention. Built from what Home already is, nothing new:
 *   - the soft filled panel the Earnings block uses (surface2, 16 px radius, no border, no shadow),
 *   - the tinted status pill the Return Cab banner uses (a dot and a bold caption),
 *   - the app's own gradient Button for the one thing to do.
 * Colour carries the meaning, and only in the pill:
 *   blocker    red     the driver cannot receive rides until this is fixed
 *   attention  amber   something to do soon (head out, confirm, booking about to open)
 *   info       teal    good to know
 *   ok         green   it worked
 */
export type StatusTone = 'blocker' | 'attention' | 'info' | 'ok'

// Text colours are the darker shade of each tint's own hue so a 12 px pill label clears 4.5:1 on its background.
export const tonePill: Record<StatusTone, { bg: string; ink: string; dot: string }> = {
  blocker: { bg: colors.errorLight, ink: '#B4262B', dot: colors.error },
  attention: { bg: colors.warningLight, ink: '#8A6420', dot: colors.warning },
  info: { bg: colors.primarySubtle, ink: colors.primaryDark, dot: colors.primary },
  ok: { bg: colors.successLight, ink: '#13795B', dot: colors.success },
}

/** The tinted status pill: a dot and a short bold label. */
export function TonePill({ tone, label }: { tone: StatusTone; label: string }) {
  const t = tonePill[tone]
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]} accessible accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      <Text style={[styles.pillText, { color: t.ink }]}>{label}</Text>
    </View>
  )
}

/** The panel: soft filled surface, same as the Earnings block. Tappable as a whole when `onPress` is given. */
export function StatusPanel({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [styles.panel, pressed ? styles.pressed : null]}>
        {children}
      </Pressable>
    )
  }
  return <View style={styles.panel} accessible={accessibilityLabel != null} accessibilityLabel={accessibilityLabel}>{children}</View>
}

type CardProps = {
  tone: StatusTone
  /** The pill: what kind of notice this is, in two or three words ("Action needed", "Back online"). */
  label: string
  title: string
  message?: string
  action?: { label: string; onPress: () => void; icon?: React.ComponentProps<typeof Button>['icon'] }
  /** Makes the whole panel tappable, with a small chevron hint (for a notice that just opens a screen). */
  onPress?: () => void
}

/** The standard notice: pill, title, one plain sentence, and at most one action. */
export function StatusCard({ tone, label, title, message, action, onPress }: CardProps) {
  return (
    <StatusPanel {...(onPress ? { onPress } : {})} accessibilityLabel={`${label}. ${title}${message ? `. ${message}` : ''}`}>
      <TonePill tone={tone} label={label} />
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
      {action ? <Button label={action.label} onPress={action.onPress} {...(action.icon ? { icon: action.icon } : {})} /> : null}
    </StatusPanel>
  )
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface2, borderRadius: 16, padding: spacing.md, gap: spacing.sm + 4 },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: spacing.sm + 4, paddingVertical: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { ...typography.caption, fontFamily: fonts.bold },
  text: { gap: 3 },
  title: { ...typography.headline, fontSize: 18, lineHeight: 24, color: colors.ink900 },
  message: { ...typography.label, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink600 },
})
