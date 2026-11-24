import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Device from 'expo-device'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, colors, fonts, radii, spacing, Text } from '@ocar/mobile-shared'
import { keepRunningGuide } from '@/features/keep-running/steps'

// Opened from Profile. Some phones stop Ocar in the background to save battery, which freezes the driver's location on the live map and
// can make them miss ride requests. Nothing here is automatic: Android does not let an app change these settings, so it shows the steps
// for this phone and opens the right system screens.
export default function KeepRunningScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const guide = keepRunningGuide(Device.brand)

  const openBattery = () => { Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => { void Linking.openSettings() }) }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.ink900} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Keep Ocar running</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.body}>
          Some phones put apps to sleep to save battery. When that happens your location stops updating, trips can lose track, and you can miss ride requests.
          Switch these on once and Ocar keeps working with the screen off.
        </Text>
        <Text style={styles.phone}>{guide.title}</Text>
        <View style={styles.steps}>
          {guide.steps.map((label, i) => (
            <View key={label} style={[styles.step, i > 0 ? styles.stepRuled : null]}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{i + 1}</Text></View>
              <Text style={styles.stepText}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.note}>Menu names change between phone versions. If you cannot find one, search Ocar in your phone settings.</Text>
        <View style={styles.actions}>
          <Button label="Open battery settings" onPress={openBattery} />
          <Button label="Open Ocar app settings" variant="secondary" onPress={() => { void Linking.openSettings() }} />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink900 },
  content: { paddingHorizontal: spacing.lg },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.ink600 },
  phone: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink900, marginTop: spacing.lg, marginBottom: spacing.xs },
  steps: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 4 },
  stepRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontFamily: fonts.bold, fontSize: 14, color: colors.primaryDark },
  stepText: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink900 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink600, marginTop: spacing.sm },
  actions: { gap: spacing.sm + 2, marginTop: spacing.lg },
})
