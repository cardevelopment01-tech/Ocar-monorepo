import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { onboardingApi, type VehicleBrand, type VehicleCategory, type VehicleInfoPayload, type VehicleModel } from '@/features/onboarding/api'
import { FUEL_TYPES, VEHICLE_COLORS } from '@/features/onboarding/constants'
import { OnboardingShell } from '@/features/onboarding/components/OnboardingShell'
import { ChipGroup, Field, PickerField, Stepper, TextField } from '@/features/onboarding/components/FormPrimitives'
import { DateField } from '@/features/onboarding/components/DateField'

const TODAY_ISO = new Date().toISOString().slice(0, 10)
const MIN_MODEL_YEAR = 1990
const MAX_MODEL_YEAR = new Date().getFullYear() + 1

function isValidPlate(p: string) { return /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(p.replace(/\s/g, '').toUpperCase()) }
function isValidYear(y: string) { return y.length === 4 && Number(y) >= MIN_MODEL_YEAR && Number(y) <= MAX_MODEL_YEAR }

export default function VehicleRegistrationScreen() {
  const router = useRouter()
  const updateDriver = useAuthStore((s) => s.updateDriver)

  const [categories, setCategories] = useState<VehicleCategory[]>([])
  const [brands, setBrands] = useState<VehicleBrand[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])
  const [loadError, setLoadError] = useState(false)
  const [isFetching, setIsFetching] = useState(true)

  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [brandId, setBrandId] = useState<number | null>(null)
  const [modelId, setModelId] = useState<number | null>(null)
  const [modelYear, setModelYear] = useState('')
  const [registrationDate, setRegistrationDate] = useState('')
  const [plate, setPlate] = useState('')
  const [color, setColor] = useState<string | null>(null)
  const [fuelType, setFuelType] = useState<string | null>(null)
  const [seating, setSeating] = useState(4)
  const [luggage, setLuggage] = useState(2)
  const [ac, setAc] = useState(true)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDropdownData = useCallback(async () => {
    setLoadError(false)
    setIsFetching(true)
    try {
      const [cats, brs, savedVehicle] = await Promise.all([
        onboardingApi.getCategories(),
        onboardingApi.getBrands(),
        onboardingApi.getVehicleInfo(),
      ])
      setCategories(cats)
      setBrands(brs)

      if (savedVehicle?.vehicle) {
        const v = savedVehicle.vehicle
        if (v.category_id) setCategoryId(Number(v.category_id))
        if (v.brand_id) { setBrandId(Number(v.brand_id)); setModels(await onboardingApi.getModels(Number(v.brand_id))) }
        if (v.model_id) setModelId(Number(v.model_id))
        if (v.model_year) setModelYear(String(v.model_year))
        if (v.registration_date) setRegistrationDate(String(v.registration_date).slice(0, 10))
        if (v.number_plate) setPlate(v.number_plate)
        if (v.color) setColor(v.color)
        if (v.fuel_type) setFuelType(v.fuel_type)
        if (v.seating_capacity) setSeating(v.seating_capacity)
        if (v.luggage_capacity != null) setLuggage(v.luggage_capacity)
        if (v.ac_availability != null) setAc(v.ac_availability)
      }
    } catch {
      setLoadError(true)
    } finally {
      setIsFetching(false)
    }
  }, [])

  useEffect(() => { void loadDropdownData() }, [loadDropdownData])

  async function handleBrandChange(id: number) {
    setBrandId(id)
    setModelId(null)
    setModels([])
    try { setModels(await onboardingApi.getModels(id)) } catch { /* ignore */ }
  }

  function handleModelChange(id: number) {
    setModelId(id)
    const model = models.find((m) => Number(m.id) === id)
    if (model?.typical_category_id) setCategoryId(Number(model.typical_category_id))
  }

  const selectedModel = models.find((m) => Number(m.id) === modelId)
  const isValid = !!(categoryId && brandId && modelId && selectedModel && modelYear && isValidYear(modelYear) && plate && isValidPlate(plate) && color && fuelType)

  async function handleContinue() {
    if (!isValid) return
    setError(null)
    setIsLoading(true)
    try {
      const payload: VehicleInfoPayload = {
        category_id: Number(categoryId),
        brand_id: Number(brandId),
        model_id: Number(modelId),
        vehicle_name: selectedModel!.name,
        model_year: parseInt(modelYear, 10),
        number_plate: plate.trim().toUpperCase().replace(/\s/g, ''),
        color: color!,
        fuel_type: fuelType as VehicleInfoPayload['fuel_type'],
        seating_capacity: seating,
        luggage_capacity: luggage,
        ac_availability: ac,
      }
      if (registrationDate) payload.registration_date = registrationDate
      const result = await onboardingApi.saveVehicleInfo(payload)
      updateDriver({ onboarding_step: result.next_step })
      router.push('/onboarding/documents')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isFetching) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Failed to load vehicle data.</Text>
        <Button label="Tap to retry" variant="ghost" icon="refresh-cw" onPress={() => void loadDropdownData()} />
      </View>
    )
  }

  const footer = (
    <>
      {!isValid && !error ? (
        <Text style={styles.hint}>
          {!brandId ? 'Select your vehicle brand'
            : !modelId ? 'Select your vehicle model'
            : !color ? 'Select vehicle colour'
            : !fuelType ? 'Select fuel type'
            : !plate ? 'Enter registration number'
            : plate && !isValidPlate(plate) ? 'Enter a valid registration number'
            : !modelYear ? 'Enter year of manufacture'
            : `Year must be between ${MIN_MODEL_YEAR} and ${MAX_MODEL_YEAR}`}
        </Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Button label="Continue" onPress={handleContinue} loading={isLoading} disabled={!isValid} />
    </>
  )

  return (
    <OnboardingShell stepIndex={1} title="Vehicle Details" footer={footer}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Feather name="truck" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>Vehicle</Text>
        </View>
        <PickerField label="Brand" value={brandId} options={brands.map((b) => ({ value: Number(b.id), label: b.name }))} onSelect={(v) => void handleBrandChange(Number(v))} placeholder="Select brand" searchable={brands.length > 6} />
        <PickerField label="Model" value={modelId} options={models.map((m) => ({ value: Number(m.id), label: m.name }))} onSelect={(v) => handleModelChange(Number(v))} placeholder={!brandId ? 'Select brand first' : 'Select model'} disabled={!brandId} searchable={models.length > 6} />
        <Field label="Vehicle Category">
          <View style={styles.categoryGrid}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategoryId(Number(c.id))}
                style={({ pressed }) => [styles.categoryBtn, categoryId === Number(c.id) ? styles.categoryBtnActive : null, pressed ? styles.pressedScale : null]}
              >
                <Text style={[styles.categoryText, categoryId === Number(c.id) ? styles.categoryTextActive : null]}>{c.display_name}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Feather name="file-text" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>Registration</Text>
        </View>
        <Field label="Registration Number">
          <TextField value={plate} onChangeText={(t) => setPlate(t.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 11))} placeholder="OD05AB1234" autoCapitalize="characters" maxLength={11} />
        </Field>
        <Field label="Year of Manufacture">
          <TextField value={modelYear} onChangeText={(t) => setModelYear(t.replace(/\D/g, '').slice(0, 4))} placeholder="2022" keyboardType="number-pad" maxLength={4} />
        </Field>
        <DateField label="Registration Date" value={registrationDate} onChange={setRegistrationDate} maxDate={TODAY_ISO} placeholder="Select registration date" />
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Feather name="sliders" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>Specifications</Text>
        </View>
        <Field label="Fuel Type">
          <ChipGroup columns={4} value={fuelType} onChange={setFuelType} options={FUEL_TYPES.map((f) => ({ value: f.value, label: f.label }))} />
        </Field>
        <Field label="Color">
          <ChipGroup value={color} onChange={setColor} options={VEHICLE_COLORS.map((c) => ({ value: c, label: c }))} />
        </Field>
        <View style={styles.stepperRow}>
          <View style={{ flex: 1 }}>
            <Field label="Seats"><Stepper value={seating} min={1} max={8} unit="seat" onChange={setSeating} /></Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Luggage Bags"><Stepper value={luggage} min={0} max={5} unit="bag" onChange={setLuggage} /></Field>
          </View>
        </View>
        <Field label="Air Conditioning">
          <View style={styles.acRow}>
            {[true, false].map((v) => (
              <Pressable
                key={String(v)}
                onPress={() => setAc(v)}
                style={({ pressed }) => [styles.acBtn, ac === v ? styles.acBtnActive : null, pressed ? styles.pressedScale : null]}
              >
                <Text style={[styles.acText, ac === v ? styles.acTextActive : null]}>{v ? 'AC Available' : 'Non-AC'}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
      </View>
    </OnboardingShell>
  )
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: spacing.sm },
  errorText: { ...typography.body, color: colors.error },
  hint: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginBottom: spacing.xs },
  // Matches personal.tsx's card pattern -- vehicle used to be a flat list of
  // fields with no grouping, the one step in the wizard that looked
  // unfinished next to personal.tsx and documents.tsx's titled sections.
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: { ...typography.body, color: colors.ink900, fontWeight: '700' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  categoryBtn: { flexBasis: '48%', flexGrow: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface2, alignItems: 'center' },
  categoryBtnActive: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  categoryText: { ...typography.body, color: colors.ink600, fontWeight: '700' },
  categoryTextActive: { color: colors.primary },
  stepperRow: { flexDirection: 'row', gap: spacing.sm },
  acRow: { flexDirection: 'row', gap: spacing.sm },
  acBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface2, alignItems: 'center' },
  acBtnActive: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  acText: { ...typography.body, color: colors.ink600, fontWeight: '700' },
  acTextActive: { color: colors.primary },
  pressedScale: { transform: [{ scale: 0.97 }] },
})
