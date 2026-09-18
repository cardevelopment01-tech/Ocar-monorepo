import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchCities, fetchMyVehicle } from '@/features/go-online/api'
import { useWalletGate } from '@/features/go-online/useWalletGate'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'
import { useConfirmGoOnline } from '@/features/go-online/useConfirmGoOnline'
import { LocationDisclosure } from '@/features/go-online/LocationDisclosure'
import { PickerField } from '@/features/onboarding/components/FormPrimitives'
import type { City, VehicleInfo } from '@/features/go-online/types'

export default function ReturnCabSetupScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const walletGate = useWalletGate()
  const documentGate = useDocumentGate()

  const [cities, setCities] = useState<City[]>([])
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null)
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null)
  const [loadingInit, setLoadingInit] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    Promise.all([fetchCities(), fetchMyVehicle()])
      .then(([cityList, v]) => { setCities(cityList); setVehicle(v) })
      .catch(() => setLoadError(true))
      .finally(() => setLoadingInit(false))
  }, [])

  const selectedCity = cities.find((c) => c.id === selectedCityId)
  const { goingOnline, showDisclosure, locationWarning, error, start, handleDisclosureAccept, handleDisclosureDecline } =
    useConfirmGoOnline(vehicle, 'return_cab', selectedCityId, selectedCity?.name)

  const canGo = !goingOnline && !loadingInit && !!vehicle && !!selectedCityId && walletGate.canGoOnline && documentGate.canGoOnline

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.ink600} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Return Cab Mode</Text>
          <Text style={styles.subtitle}>You'll only get rides heading your way</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {documentGate.hasRejected ? (
          <View style={styles.gateCard}>
            <Feather name="alert-triangle" size={15} color={colors.error} />
            <Text style={styles.gateText}>{documentGate.rejectionReason ?? 'A document was rejected. Check your profile.'}</Text>
          </View>
        ) : null}

        <View style={styles.heroWrap}>
          <View style={styles.heroIcon}>
            <Feather name="corner-up-left" size={34} color={colors.inkInverse} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Where are you heading?</Text>
          {loadingInit ? (
            <ActivityIndicator color={colors.primary} />
          ) : loadError ? (
            <Text style={styles.errorText}>Could not load cities.</Text>
          ) : (
            <PickerField
              label="Destination city"
              value={selectedCityId}
              options={cities.map((c) => ({ value: c.id, label: c.name }))}
              onSelect={(v) => setSelectedCityId(Number(v))}
              placeholder="Select destination city"
              searchable={cities.length > 6}
            />
          )}
          {selectedCity ? (
            <Text style={styles.hint}>
              You'll only receive rides going towards <Text style={styles.hintStrong}>{selectedCity.name}</Text>. Discounted return rates apply.
            </Text>
          ) : null}
        </View>

        {locationWarning ? <Text style={styles.warningText}>GPS unavailable, using your default location</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Pressable onPress={start} disabled={!canGo} style={[styles.ctaBtn, !canGo ? styles.disabled : null]}>
          {goingOnline ? <ActivityIndicator color={colors.inkInverse} /> : (
            <>
              <Feather name="zap" size={16} color={colors.inkInverse} />
              <Text style={styles.ctaText}>Go Online as Return Cab</Text>
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
  title: { ...typography.headline, color: colors.ink900, fontWeight: '800' },
  subtitle: { ...typography.caption, color: colors.ink400, marginTop: 2 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },
  gateCard: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.errorLight, borderRadius: radii.lg, padding: spacing.sm + 4 },
  gateText: { ...typography.caption, color: colors.ink900, flex: 1 },
  heroWrap: { alignItems: 'center', marginVertical: spacing.sm },
  heroIcon: { width: 80, height: 80, borderRadius: radii['2xl'], backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  cardTitle: { ...typography.body, color: colors.ink900, fontWeight: '700', marginBottom: spacing.xs },
  hint: { ...typography.caption, color: colors.ink400, marginTop: spacing.xs },
  hintStrong: { color: colors.ink600, fontWeight: '700' },
  warningText: { ...typography.caption, color: colors.ink600, textAlign: 'center' },
  errorText: { ...typography.caption, color: colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.success, borderRadius: radii.xl, paddingVertical: spacing.md, minHeight: 56 },
  disabled: { opacity: 0.4 },
  ctaText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
})
