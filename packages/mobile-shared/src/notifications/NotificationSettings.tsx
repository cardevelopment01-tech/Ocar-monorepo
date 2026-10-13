import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'
import type { PushPermissionState } from './pushPermission'

export type NotificationSettingsProps = {
  /** What the app sends, in the user's words (one row each). Mirrors the app's Android channels. */
  topics: { name: string; description: string }[]
  permission: { state: PushPermissionState | null; canAskAgain: boolean }
  onEnablePush: () => void
  onBack: () => void
}

export function NotificationSettings({ topics, permission, onEnablePush, onBack }: NotificationSettingsProps) {
  const insets = useSafeAreaInsets()
  const granted = permission.state === 'granted'

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Feather name="arrow-left" size={18} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title}>Notification settings</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, gap: spacing.md }}>
        <View style={styles.card}>
          <View style={[styles.statusIcon, granted ? styles.statusOn : styles.statusOff]}>
            <Feather name={granted ? 'bell' : 'bell-off'} size={18} color={granted ? colors.primary : colors.warning} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{permission.state === null ? 'Checking…' : granted ? 'Notifications are on' : 'Notifications are off'}</Text>
            <Text style={styles.cardText}>
              {granted ? 'This phone will alert you even when the app is closed.' : 'Turn them on so you don’t miss anything important.'}
            </Text>
          </View>
          {permission.state !== null && !granted ? (
            <Pressable onPress={onEnablePush} style={styles.cta} accessibilityRole="button">
              <Text style={styles.ctaText}>{permission.canAskAgain ? 'Turn on' : 'Settings'}</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>What you&apos;ll get</Text>
        <View style={styles.card2}>
          {topics.map((t, i) => (
            <View key={t.name} style={[styles.topic, i > 0 ? styles.topicBorder : null]}>
              <Text style={styles.topicName}>{t.name}</Text>
              <Text style={styles.topicText}>{t.description}</Text>
            </View>
          ))}
        </View>

        <Pressable onPress={() => { void Linking.openSettings() }} style={styles.systemRow} accessibilityRole="button">
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Sound, pop-up and vibration</Text>
            <Text style={styles.cardText}>Change how each type alerts you in your phone&apos;s settings.</Text>
          </View>
          <Feather name="external-link" size={17} color={colors.ink400} />
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, flex: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  card2: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
  statusIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statusOn: { backgroundColor: colors.primarySubtle },
  statusOff: { backgroundColor: colors.warningLight },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { ...typography.body, lineHeight: 20, color: colors.ink900, fontFamily: fonts.semibold },
  cardText: { ...typography.caption, color: colors.ink600 },
  cta: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radii.full, backgroundColor: colors.ink900 },
  ctaText: { ...typography.caption, color: colors.inkInverse, fontFamily: fonts.bold },
  sectionTitle: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.sm },
  topic: { padding: spacing.md, gap: 2 },
  topicBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  topicName: { ...typography.body, lineHeight: 20, color: colors.ink900, fontFamily: fonts.semibold },
  topicText: { ...typography.caption, color: colors.ink600 },
  systemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
})
