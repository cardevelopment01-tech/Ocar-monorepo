import { ScrollView, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Button, colors, fonts, radii, shadow, spacing, Text } from '@ocar/mobile-shared'
import { BottomSheet } from './components/BottomSheet'

export interface LocationDisclosureProps {
  visible: boolean
  onAccept: () => void
  onDecline: () => void
}

const POINTS: { icon: 'target' | 'navigation' | 'clock'; title: string; body: string }[] = [
  { icon: 'target', title: 'Match you with nearby rides', body: 'Nearest requests come to you first.' },
  { icon: 'navigation', title: 'Track active trips', body: 'Works with the screen off too.' },
  { icon: 'clock', title: 'Only while you are online', body: 'Stops the moment you go offline.' },
]

// Google Play requires this shown in normal app flow (not buried in settings)
// before the background-location permission dialog fires -- see spec Section 4.
// The disclosure itself (what is collected, why, and when) stays in plain words above the buttons.
export function LocationDisclosure({ visible, onAccept, onDecline }: LocationDisclosureProps) {
  return (
    <BottomSheet visible={visible} onClose={onDecline}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={styles.iconRing}>
          <View style={styles.icon}>
            <Feather name="map-pin" size={26} color={colors.primary} />
          </View>
        </View>
        <Text style={styles.title} accessibilityRole="header">Location while you drive</Text>
        <Text style={styles.body}>Ocar uses your location in the background to send you ride requests and track your trips.</Text>

        <View style={styles.points}>
          {POINTS.map((p, i) => (
            <View key={p.title} style={[styles.point, i > 0 ? styles.pointRuled : null]}>
              <View style={styles.pointIcon}>
                <Feather name={p.icon} size={18} color={colors.primaryDark} />
              </View>
              <View style={styles.pointText}>
                <Text style={styles.pointTitle}>{p.title}</Text>
                <Text style={styles.pointBody}>{p.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Button label="Allow background location" onPress={onAccept} />
          <Button label="Not now" variant="secondary" onPress={onDecline} />
        </View>
      </ScrollView>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  // One centered column for the header; the grouped points and the buttons span the full width.
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: spacing.lg, alignItems: 'center' },
  iconRing: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.sm },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: colors.ink900, textAlign: 'center', marginTop: spacing.md },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.ink600, textAlign: 'center', marginTop: spacing.xs + 2, maxWidth: 320 },
  points: { alignSelf: 'stretch', backgroundColor: colors.bg, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginTop: spacing.md + 2 },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 4 },
  pointRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pointIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, minWidth: 0 },
  pointTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, color: colors.ink900 },
  pointBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink600 },
  actions: { alignSelf: 'stretch', gap: spacing.sm + 2, marginTop: spacing.md + 2 },
})
