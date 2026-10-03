import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, Card, colors, h, radii, shadow, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { fetchCities, fetchMyVehicle } from '@/features/go-online/api'
import { useWalletGate } from '@/features/go-online/useWalletGate'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'
import { useConfirmGoOnline } from '@/features/go-online/useConfirmGoOnline'
import { LocationDisclosure } from '@/features/go-online/LocationDisclosure'
import { PickerField } from '@/features/onboarding/components/FormPrimitives'
import type { City, VehicleInfo } from '@/features/go-online/types'
import { GlassChip, ModeHero } from '@/features/go-online/components/ModeHero'

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
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={4}>
          <Feather name="arrow-left" size={20} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Return cab</Text>
        <Text style={styles.subtitle}>Drive home, and get paid on the way.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {documentGate.hasRejected ? (
          <View style={styles.gateCard}>
            <Feather name="alert-triangle" size={15} color={colors.error} />
            <Text style={styles.gateText}>{documentGate.rejectionReason ?? 'A document was rejected. Check your profile.'}</Text>
          </View>
        ) : null}

        <ModeHero kind="return" height={200}>
          <View style={styles.heroTop}>
            <GlassChip icon="corner-up-left" label="Heading somewhere" />
          </View>
          <View style={styles.heroBottom}>
            <Text style={styles.heroLabel}>{selectedCity ? 'Going towards' : 'Your destination'}</Text>
            <Text style={styles.heroTitle} numberOfLines={1}>{selectedCity ? selectedCity.name : 'Choose below'}</Text>
          </View>
        </ModeHero>

        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Where are you heading?</Text>
          {loadingInit ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
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
              You will only receive rides going towards <Text style={styles.hintStrong}>{selectedCity.name}</Text>. Discounted return rates apply.
            </Text>
          ) : null}
        </Card>

        {locationWarning ? <Text style={styles.warningText}>GPS unavailable, using your default location</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Button label="Go online as return cab" loading={goingOnline} disabled={!canGo} onPress={start} />
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
  heroBottom: { position: 'absolute', left: spacing.md + 2, right: spacing.md + 2, bottom: spacing.md + 2, gap: 2 },
  heroLabel: { ...typography.label, color: 'rgba(255,255,255,0.88)', fontFamily: fonts.semibold },
  heroTitle: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.5, color: colors.inkInverse },
  card: { gap: spacing.sm, padding: spacing.md + 4, borderRadius: radii['2xl'], boxShadow: shadow.sm },
  cardLabel: { ...typography.title, fontSize: 16, color: colors.ink900, fontFamily: fonts.bold },
  loading: { paddingVertical: spacing.md },
  hint: { ...typography.label, color: colors.ink600 },
  hintStrong: { color: colors.ink900, fontFamily: fonts.bold },
  warningText: { ...typography.caption, color: colors.ink600, textAlign: 'center' },
  errorText: { ...typography.caption, color: colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
})
