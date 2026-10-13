import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '../ui/Text'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'
import type { NotificationTone } from './feedModel'
import { NotificationHeader, ToneTile } from './notificationUi'
import type { PushPermissionState } from './pushPermission'

export type NotificationSettingsProps = {
  /** What the app sends, in the user's words (one row each). Mirrors the app's Android channels. */
  topics: { name: string; description: string; icon?: string; tone?: NotificationTone }[]
  permission: { state: PushPermissionState | null; canAskAgain: boolean }
  onEnablePush: () => void
  onBack: () => void
  /** Optional categories the user can switch off. Omit until the preferences have loaded. */
  switches?: { label: string; description: string; value: boolean; onChange: (value: boolean) => void; icon?: string; tone?: NotificationTone }[]
}

export function NotificationSettings({ topics, permission, onEnablePush, onBack, switches }: NotificationSettingsProps) {
  const insets = useSafeAreaInsets()
  const granted = permission.state === 'granted'

  return (
    <View style={styles.container}>
      <NotificationHeader title="Notification settings" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
        <View style={styles.status}>
          <ToneTile icon={granted ? 'bell' : 'bell-off'} tone={granted ? 'ride' : 'money'} size={44} />
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{permission.state === null ? 'Checking…' : granted ? 'Notifications are on' : 'Notifications are off'}</Text>
            <Text style={styles.cardText}>
              {granted ? 'This phone will alert you even when the app is closed.' : 'Turn them on so you don’t miss anything important.'}
            </Text>
          </View>
          {permission.state !== null && !granted ? (
            <Pressable onPress={onEnablePush} style={styles.pill} accessibilityRole="button">
              <Text style={styles.pillText}>{permission.canAskAgain ? 'Turn on' : 'Settings'}</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>What you’ll get</Text>
        <View style={styles.group}>
          {topics.map((t, i) => (
            <View key={t.name} style={styles.item}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <ToneTile icon={t.icon ?? 'bell'} tone={t.tone ?? 'ride'} size={40} />
              <View style={styles.flex}>
                <Text style={styles.itemTitle}>{t.name}</Text>
                <Text style={styles.itemText}>{t.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {switches && switches.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>You can switch off</Text>
            <View style={styles.group}>
              {switches.map((s, i) => (
                <View key={s.label} style={[styles.item, styles.itemSwitch]}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <ToneTile icon={s.icon ?? 'bell'} tone={s.tone ?? 'promo'} size={40} />
                  <View style={styles.flex}>
                    <Text style={styles.itemTitle}>{s.label}</Text>
                    <Text style={styles.itemText}>{s.description}</Text>
                  </View>
                  <Switch
                    value={s.value}
                    onValueChange={s.onChange}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.surface}
                    accessibilityLabel={s.label}
                  />
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Pressable onPress={() => { void Linking.openSettings() }} style={({ pressed }) => [styles.system, pressed ? styles.pressed : null]} accessibilityRole="button">
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Sound, pop-up and vibration</Text>
            <Text style={styles.cardText}>Change how each type alerts you in your phone’s settings.</Text>
          </View>
          <Feather name="external-link" size={17} color={colors.ink400} />
        </Pressable>
      </ScrollView>
    </View>
  )
}

const TILE = 40
const PAD = spacing.md
const DIVIDER_INSET = PAD + TILE + spacing.sm + 4

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, gap: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, backgroundColor: colors.surface, borderRadius: radii['2xl'], borderWidth: 1, borderColor: colors.border, padding: PAD },
  system: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii['2xl'], borderWidth: 1, borderColor: colors.border, padding: PAD },
  pressed: { backgroundColor: colors.surface3 },
  cardTitle: { ...typography.label, fontSize: 15, lineHeight: 20, color: colors.ink900, fontFamily: fonts.semibold },
  cardText: { ...typography.caption, lineHeight: 18, color: colors.ink600 },
  pill: { paddingHorizontal: spacing.md, height: 34, borderRadius: radii.full, backgroundColor: colors.ink900, alignItems: 'center', justifyContent: 'center' },
  pillText: { ...typography.label, color: colors.inkInverse, fontFamily: fonts.bold },
  // Sentence-case, not tracked caps: DESIGN.md's No Eyebrow Rule.
  sectionTitle: { ...typography.label, fontSize: 14, color: colors.ink600, fontFamily: fonts.semibold, marginTop: spacing.xs },
  group: { backgroundColor: colors.surface, borderRadius: radii['2xl'], borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 4, padding: PAD },
  itemSwitch: { alignItems: 'center' },
  divider: { position: 'absolute', top: 0, left: DIVIDER_INSET, right: PAD, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  itemTitle: { fontSize: 15, lineHeight: 20, color: colors.ink900, fontFamily: fonts.semibold },
  itemText: { fontSize: 13, lineHeight: 19, color: colors.ink600, fontFamily: fonts.regular },
})
