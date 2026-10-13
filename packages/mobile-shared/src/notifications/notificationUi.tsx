import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '../ui/Text'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'
import type { NotificationTone } from './feedModel'

type FeatherName = React.ComponentProps<typeof Feather>['name']

// Gold text on accentLight: the palette's own accent is too pale for a glyph at 20px.
const GOLD = '#9A6B14'

export const TONES: Record<NotificationTone, { bg: string; fg: string }> = {
  // Alpha tints (not solid fills) so a tile stays visible on a white row and on the teal-tinted unread row.
  ride: { bg: 'rgba(14,143,163,0.16)', fg: colors.primaryDark },
  money: { bg: colors.accentLight, fg: GOLD },
  account: { bg: 'rgba(95,102,106,0.13)', fg: colors.ink600 },
  promo: { bg: colors.accentLight, fg: GOLD },
  urgent: { bg: colors.errorLight, fg: colors.error },
}

/** Rounded-square glyph tile; the same shape in the feed, the settings list and the empty state. */
export function ToneTile({ icon, tone, size = 44 }: { icon: string; tone: NotificationTone; size?: number }) {
  const t = TONES[tone]
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name={icon as FeatherName} size={Math.round(size * 0.45)} color={t.fg} />
    </View>
  )
}

/** The app's standard screen header (white 40px circle back button, headline title), with an optional second line. */
export function NotificationHeader({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack: () => void; right?: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable onPress={onBack} hitSlop={8} style={styles.circleBtn} accessibilityRole="button" accessibilityLabel="Back">
        <Feather name="arrow-left" size={18} color={colors.ink900} />
      </Pressable>
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  )
}

export function HeaderIconButton({ icon, label, onPress }: { icon: FeatherName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.circleBtn} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={icon} size={17} color={colors.ink900} />
    </Pressable>
  )
}

export const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  circleBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(20,23,26,0.08)', alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1 },
  title: { ...typography.headline, fontSize: 20, color: colors.ink900, fontFamily: fonts.bold },
  subtitle: { ...typography.caption, color: colors.ink400, marginTop: 1 },
})
