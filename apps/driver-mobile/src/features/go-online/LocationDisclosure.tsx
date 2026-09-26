import { Modal, StyleSheet, View } from 'react-native'
import { Button, colors, spacing, typography, Text } from '@ocar/mobile-shared'

export interface LocationDisclosureProps {
  visible: boolean
  onAccept: () => void
  onDecline: () => void
}

// Google Play requires this shown in normal app flow (not buried in settings)
// before the background-location permission dialog fires -- see spec Section 4.
export function LocationDisclosure({ visible, onAccept, onDecline }: LocationDisclosureProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Location access</Text>
          <Text style={styles.body}>
            Ocar needs your location in the background to match you with nearby ride requests and track
            active trips, even while the app is minimized. This only runs while you're online.
          </Text>
          <Button label="Allow background location" onPress={onAccept} />
          <Button label="Not now" variant="ghost" onPress={onDecline} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: `${colors.ink900}99`, justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: spacing.lg, gap: spacing.md },
  title: { ...typography.headline, color: colors.ink900 },
  body: { ...typography.body, color: colors.ink600 },
})
