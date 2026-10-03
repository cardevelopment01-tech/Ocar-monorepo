import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, Card, colors, h, radii, shadow, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { fetchMyVehicle } from '@/features/go-online/api'
import { useWalletGate } from '@/features/go-online/useWalletGate'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'
import { useConfirmGoOnline } from '@/features/go-online/useConfirmGoOnline'
import { LocationDisclosure } from '@/features/go-online/LocationDisclosure'
import type { VehicleInfo } from '@/features/go-online/types'
import { GlassChip, ModeHero, PlateTile } from '@/features/go-online/components/ModeHero'

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
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={4}>
          <Feather name="arrow-left" size={20} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Ready to go online?</Text>
        <Text style={styles.subtitle}>Confirm, then requests start coming in.</Text>
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

        <ModeHero kind="standard" height={208}>
          <View style={styles.heroTop}>
            <GlassChip icon="map-pin" label="Standard mode" />
          </View>
          <View style={styles.heroBottom}>
            <Text style={styles.heroLabel}>Your vehicle</Text>
            {loading ? (
              <ActivityIndicator color={colors.inkInverse} style={styles.heroLoading} />
            ) : vehicle ? (
              <PlateTile plate={vehicle.numberPlate} />
            ) : (
              <Text style={styles.heroMissing}>No vehicle registered</Text>
            )}
          </View>
        </ModeHero>

        <Card style={styles.checklistCard}>
          <Text style={styles.cardLabel}>Before you start</Text>
          {CHECKLIST.map((item, i) => {
            const isChecked = checked[item] ?? true
            return (
              <Pressable
                key={item}
                onPress={() => setChecked((prev) => ({ ...prev, [item]: !prev[item] }))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isChecked }}
                style={[styles.checklistRow, i > 0 ? styles.checklistRowRuled : null]}
              >
                <View style={[styles.checkbox, isChecked ? styles.checkboxOn : null]}>
                  {isChecked ? <Feather name="check" size={13} color={colors.inkInverse} /> : null}
                </View>
                <Text style={[styles.checklistText, !isChecked ? styles.checklistTextOff : null]}>{item}</Text>
              </Pressable>
            )
          })}
        </Card>

        {locationWarning ? <Text style={styles.warningText}>GPS unavailable, using your default location</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Button label="Go online" loading={goingOnline} disabled={!canGo} onPress={start} />
      </View>

      <LocationDisclosure visible={showDisclosure} onAccept={() => void handleDisclosureAccept()} onDecline={handleDisclosureDecline} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs },
  // Same round white control as Home's wallet and bell pills.
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: h.line08, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm, boxShadow: shadow.sm },
  title: { ...typography.display, color: colors.ink900 },
  subtitle: { ...typography.body, color: colors.ink600 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  gateCard: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.errorLight, borderRadius: radii.lg, padding: spacing.sm + 4 },
  gateText: { ...typography.caption, color: colors.ink900, flex: 1 },
  heroTop: { position: 'absolute', top: spacing.md + 2, left: spacing.md + 2 },
  heroBottom: { position: 'absolute', left: spacing.md + 2, right: spacing.md + 2, bottom: spacing.md + 2, gap: spacing.sm },
  heroLabel: { ...typography.label, color: 'rgba(255,255,255,0.88)', fontFamily: fonts.semibold },
  heroLoading: { alignSelf: 'flex-start' },
  heroMissing: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.semibold },
  cardLabel: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  checklistCard: { paddingVertical: spacing.md, paddingHorizontal: spacing.md + 4, boxShadow: shadow.sm },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, minHeight: 52 },
  checklistRowRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkbox: { width: 24, height: 24, borderRadius: radii.full, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checklistText: { ...typography.body, color: colors.ink900, fontFamily: fonts.medium, flex: 1 },
  checklistTextOff: { color: colors.ink600, textDecorationLine: 'line-through' },
  warningText: { ...typography.caption, color: colors.ink600, textAlign: 'center' },
  errorText: { ...typography.caption, color: colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
})
