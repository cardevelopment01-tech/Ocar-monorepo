import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchMyVehicle } from '@/features/go-online/api'
import { useWalletGate } from '@/features/go-online/useWalletGate'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'
import { useConfirmGoOnline } from '@/features/go-online/useConfirmGoOnline'
import { LocationDisclosure } from '@/features/go-online/LocationDisclosure'
import type { VehicleInfo } from '@/features/go-online/types'

const CHECKLIST = ['Vehicle is clean and ready', 'AC is working properly', 'Phone is charged', 'Documents are up to date']

export default function StandardConfirmScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const walletGate = useWalletGate()
  const documentGate = useDocumentGate()

  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(CHECKLIST.map((i) => [i, true])))

  useEffect(() => {
    fetchMyVehicle().then(setVehicle).finally(() => setLoading(false))
  }, [])

  const { goingOnline, showDisclosure, locationWarning, error, start, handleDisclosureAccept, handleDisclosureDecline } =
    useConfirmGoOnline(vehicle, 'standard', null, undefined)

  const canGo = !goingOnline && !loading && !!vehicle && walletGate.canGoOnline && documentGate.canGoOnline

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.ink600} />
        </Pressable>
        <Text style={styles.title}>You're almost online!</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {documentGate.hasRejected ? (
          <View style={styles.gateCard}>
            <Feather name="alert-triangle" size={15} color={colors.error} />
            <Text style={styles.gateText}>{documentGate.rejectionReason ?? 'A document was rejected. Check your profile.'}</Text>
          </View>
        ) : null}
        {walletGate.isFrozen ? (
          <View style={styles.gateCard}>
            <Feather name="alert-triangle" size={15} color={colors.error} />
            <Text style={styles.gateText}>Your wallet is frozen. Contact support.</Text>
          </View>
        ) : null}

        <View style={styles.vehicleCard}>
          <View style={styles.vehicleIconTile}>
            <Feather name="truck" size={24} color={colors.inkInverse} />
          </View>
          <View style={{ flex: 1 }}>
            {loading ? (
              <ActivityIndicator color={colors.inkInverse} />
            ) : vehicle ? (
              <>
                <View style={styles.plateBadge}>
                  <Text style={styles.plateText}>{vehicle.numberPlate}</Text>
                </View>
                <Text style={styles.vehicleMeta}>Standard Mode</Text>
              </>
            ) : (
              <Text style={styles.vehicleMissing}>No vehicle registered</Text>
            )}
          </View>
        </View>

        <View style={styles.checklistCard}>
          <View style={styles.checklistHeader}>
            <Feather name="zap" size={14} color={colors.ink900} />
            <Text style={styles.checklistTitle}>Pre-ride Checklist</Text>
            <Text style={styles.checklistHint}>Tap to toggle</Text>
          </View>
          {CHECKLIST.map((item) => {
            const isChecked = checked[item] ?? true
            return (
              <Pressable
                key={item}
                onPress={() => setChecked((prev) => ({ ...prev, [item]: !prev[item] }))}
                style={styles.checklistRow}
              >
                <View style={[styles.checkbox, isChecked ? styles.checkboxOn : null]}>
                  {isChecked ? <Feather name="check" size={11} color={colors.inkInverse} /> : null}
                </View>
                <Text style={[styles.checklistText, !isChecked ? styles.checklistTextOff : null]}>{item}</Text>
              </Pressable>
            )
          })}
        </View>

        {locationWarning ? <Text style={styles.warningText}>GPS unavailable, using your default location</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Pressable onPress={start} disabled={!canGo} style={[styles.ctaBtn, !canGo ? styles.disabled : null]}>
          {goingOnline ? <ActivityIndicator color={colors.inkInverse} /> : (
            <>
              <Feather name="zap" size={16} color={colors.inkInverse} />
              <Text style={styles.ctaText}>Go Online Now</Text>
            </>
          )}
        </Pressable>
      </View>

      <LocationDisclosure visible={showDisclosure} onAccept={() => void handleDisclosureAccept()} onDecline={handleDisclosureDecline} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  backBtn: { width: 44, height: 44, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '800', flex: 1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },
  gateCard: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.errorLight, borderRadius: radii.lg, padding: spacing.sm + 4 },
  gateText: { ...typography.caption, color: colors.ink900, flex: 1 },
  vehicleCard: { flexDirection: 'row', gap: spacing.md, backgroundColor: '#0F172A', borderRadius: radii['2xl'], padding: spacing.lg, alignItems: 'center' },
  vehicleIconTile: { width: 56, height: 56, borderRadius: radii.xl, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  plateBadge: { alignSelf: 'flex-start', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radii.md, paddingHorizontal: spacing.sm + 4, paddingVertical: 4, marginBottom: 4 },
  plateText: { fontSize: 20, fontWeight: '800', color: colors.inkInverse, letterSpacing: 2 },
  vehicleMeta: { ...typography.caption, color: 'rgba(255,255,255,0.5)' },
  vehicleMissing: { ...typography.body, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  checklistCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  checklistHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  checklistTitle: { ...typography.body, color: colors.ink900, fontWeight: '700' },
  checklistHint: { ...typography.caption, color: colors.ink400, marginLeft: 'auto' },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  checkbox: { width: 22, height: 22, borderRadius: radii.full, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  checklistText: { ...typography.body, color: colors.ink900, fontWeight: '500' },
  checklistTextOff: { color: colors.ink400, textDecorationLine: 'line-through' },
  warningText: { ...typography.caption, color: colors.ink600, textAlign: 'center' },
  errorText: { ...typography.caption, color: colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: '#0F172A', borderRadius: radii.xl, paddingVertical: spacing.md, minHeight: 56 },
  disabled: { opacity: 0.4 },
  ctaText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
})
