import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '../ui/Button'
import { colors, fonts, spacing, typography } from '../theme/tokens'
import { missingRequired, type PermissionRowModel } from './permissionRules'

type Props = {
  title: string
  subtitle: string
  /** null while the phone is still being asked what is already on. */
  rows: PermissionRowModel[] | null
  /** The key of the row whose system dialog is open right now. */
  busyKey: string | null
  onAllow: (key: string) => void
  onContinue: () => void
  onSkip: () => void
}

/**
 * Every permission the app needs, in one place, in one grouped panel (the same soft fill and hairline dividers as the rest of the app): what it
 * is for in a sentence, and one button each. "Continue" opens once the required ones are on; "Not now" is always there and the screen comes
 * back the next day, so nobody is trapped and nobody quietly misses ride news because they never found a settings page.
 */
export function PermissionSetup({ title, subtitle, rows, busyKey, onAllow, onContinue, onSkip }: Props) {
  const insets = useSafeAreaInsets()
  const ready = rows !== null && missingRequired(rows).length === 0
  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <View style={styles.group}>
          {(rows ?? []).map((row, i) => (
            <View key={row.key} style={[styles.row, i > 0 ? styles.sep : null]}>
              <View style={styles.text}>
                <Text style={styles.rowTitle}>
                  {row.title}
                  {row.required ? null : <Text style={styles.optional}>{'  Optional'}</Text>}
                </Text>
                <Text style={styles.reason}>{row.reason}</Text>
              </View>
              {row.status === 'granted' ? (
                <View style={styles.on} accessible accessibilityLabel={`${row.title} is on`}>
                  <Feather name="check" size={16} color={colors.success} />
                  <Text style={styles.onText}>On</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => onAllow(row.key)}
                  disabled={busyKey !== null}
                  accessibilityRole="button"
                  accessibilityLabel={row.status === 'blocked' ? `Open settings to allow ${row.title}` : `${row.actionLabel}: ${row.title}`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.soft, pressed || busyKey === row.key ? styles.pressed : null]}
                >
                  <Text style={styles.softText}>{row.status === 'blocked' ? 'Settings' : row.actionLabel}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
        <Button label="Continue" variant="cta" disabled={!ready} onPress={onContinue} />
        <Button label="Not now" variant="soft" onPress={onSkip} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, color: colors.ink900, marginTop: spacing.md },
  subtitle: { ...typography.body, fontSize: 15, lineHeight: 22, color: colors.ink600, marginTop: spacing.sm, marginBottom: spacing.lg },
  group: { backgroundColor: colors.surface2, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingVertical: 14, paddingLeft: spacing.md, paddingRight: 14, minHeight: 72 },
  sep: { borderTopWidth: 1, borderTopColor: colors.border },
  text: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.ink900 },
  optional: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink600 },
  reason: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink600 },
  soft: { minHeight: 44, minWidth: 76, paddingHorizontal: spacing.md, borderRadius: 22, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  softText: { fontFamily: fonts.bold, fontSize: 13, color: colors.primaryDark },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  on: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 76, justifyContent: 'center' },
  onText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.primaryDark },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm + 2 },
})
