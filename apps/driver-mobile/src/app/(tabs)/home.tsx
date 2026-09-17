import { StyleSheet, Text, View } from 'react-native'
import { Button, Card, colors, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { LocationDisclosure } from '@/features/go-online/LocationDisclosure'
import { useGoOnlineFlow } from '@/features/go-online/useGoOnlineFlow'
import { useWalletGate } from '@/features/go-online/useWalletGate'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'

export default function HomeScreen() {
  const driver = useAuthStore((s) => s.driver)
  const isOnline = useDriverSessionStore((s) => s.isOnline)
  const flow = useGoOnlineFlow()
  const walletGate = useWalletGate()
  const documentGate = useDocumentGate()

  const blockedReason = documentGate.hasRejected
    ? (documentGate.rejectionReason ?? 'A document was rejected. Check your profile.')
    : walletGate.isFrozen
      ? 'Your wallet is frozen. Contact support.'
      : null

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hi {driver?.full_name ?? 'driver'}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, isOnline ? styles.statusDotOnline : styles.statusDotOffline]} />
          <Text style={styles.statusLabel}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>
      </View>

      <Card style={styles.card}>
        {flow.vehicleLoading ? (
          <Text style={styles.detail}>Loading vehicle…</Text>
        ) : flow.vehicle ? (
          <>
            <Text style={styles.plate}>{flow.vehicle.numberPlate}</Text>
            <Text style={styles.detail}>Category {flow.vehicle.categoryId}</Text>
          </>
        ) : (
          <Text style={styles.detail}>No vehicle registered</Text>
        )}
      </Card>

      {blockedReason ? (
        <Card style={styles.card}>
          <Text style={styles.error}>{blockedReason}</Text>
        </Card>
      ) : null}

      {flow.error ? (
        <Card style={styles.card}>
          <Text style={styles.error}>{flow.error}</Text>
        </Card>
      ) : null}

      {isOnline ? (
        <Button label="Go Offline" variant="secondary" onPress={() => void flow.goOffline()} />
      ) : flow.sessionCheck === 'failed' ? (
        <Card style={styles.card}>
          <Text style={styles.error}>Couldn't check your status.</Text>
          <Button label="Retry" onPress={flow.retrySessionCheck} />
        </Card>
      ) : (
        <Button
          label="Go Online"
          loading={flow.goingOnline}
          disabled={!flow.canGoOnline || !!blockedReason || !flow.vehicle}
          onPress={flow.requestGoOnline}
        />
      )}

      <LocationDisclosure
        visible={flow.showDisclosure}
        onAccept={() => void flow.handleDisclosureAccept()}
        onDecline={flow.handleDisclosureDecline}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg, gap: spacing.md },
  header: { gap: spacing.xs },
  greeting: { ...typography.headline, color: colors.ink900 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOnline: { backgroundColor: colors.success },
  statusDotOffline: { backgroundColor: colors.ink400 },
  statusLabel: { ...typography.label, color: colors.ink600 },
  card: { gap: spacing.sm },
  plate: { ...typography.title, color: colors.ink900, letterSpacing: 2 },
  detail: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error },
})
