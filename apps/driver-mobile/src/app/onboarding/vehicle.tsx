import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import axios from 'axios'
import { Button, colors, radii, spacing, typography, fonts, Text, VehicleIcon, getApiErrorMessage } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { onboardingApi, type VehicleBrand, type VehicleCategory, type VehicleInfoPayload, type VehicleModel } from '@/features/onboarding/api'
import { VEHICLE_COLORS, fuelOptionsFor } from '@/features/onboarding/constants'
import { OnboardingShell } from '@/features/onboarding/components/OnboardingShell'
import { ChipGroup, Field, PickerField, Stepper, TextField } from '@/features/onboarding/components/FormPrimitives'
import { DateField } from '@/features/onboarding/components/DateField'

const TODAY_ISO = new Date().toISOString().slice(0, 10)
const MIN_MODEL_YEAR = 1990
const MAX_MODEL_YEAR = new Date().getFullYear() + 1

function isValidPlate(p: string) { return /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(p.replace(/\s/g, '').toUpperCase()) }
function isValidYear(y: string) { return y.length === 4 && Number(y) >= MIN_MODEL_YEAR && Number(y) <= MAX_MODEL_YEAR }

function LockNote({ children }: { children: string }) {
  return (
    <View style={styles.lockNote}>
      <Feather name="lock" size={12} color={colors.ink600} />
      <Text style={styles.lockNoteText}>{children}</Text>
    </View>
  )
}

export default function VehicleRegistrationScreen() {
  const router = useRouter()
  // ?edit=1 -> opened from Profile by an onboarded driver: save and go back instead of advancing the wizard
  const isEdit = useLocalSearchParams<{ edit?: string }>().edit === '1'
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
  // The model fixes the category and the category fixes the seats; a driver whose model is not listed picks the category
  // themselves and an admin confirms it.
  const [unlisted, setUnlisted] = useState(false)
  const [customModel, setCustomModel] = useState('')
  const seating = categories.find((c) => c.id === categoryId)?.max_passengers ?? 4
  const luggage = categories.find((c) => c.id === categoryId)?.luggage_capacity ?? 2
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
        if (v.number_plate) setPlate(v.number_plate.replace(/[^A-Z0-9]/gi, '').toUpperCase())
        if (v.color) setColor(v.color)
        if (v.fuel_type) setFuelType(v.fuel_type)
        if (!v.model_id && v.vehicle_name) { setUnlisted(true); setCustomModel(v.vehicle_name) }
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
    // a model without a category leaves the choice to the driver, not to the previous model's category
    setCategoryId(model?.typical_category_id ? Number(model.typical_category_id) : null)
    // fuel: only what the model is sold with; a single option is chosen for the driver
    const fuels = fuelOptionsFor(model)
    if (fuels.length === 1) setFuelType(fuels[0]!.value)
    else if (fuelType && !fuels.some((f) => f.value === fuelType)) setFuelType(null)
  }

  const selectedModel = unlisted ? undefined : models.find((m) => Number(m.id) === modelId)
  const locked = !!selectedModel?.typical_category_id
  const modelOk = unlisted ? customModel.trim().length >= 2 : !!(modelId && selectedModel)
  // a saved fuel the model is not sold with does not count as chosen (the chips hide it)
  const fuelOk = !!fuelType && fuelOptionsFor(selectedModel).some((f) => f.value === fuelType)
  const isValid = !!(categoryId && brandId && modelOk && modelYear && isValidYear(modelYear) && plate && isValidPlate(plate) && color && fuelOk)

  async function handleContinue() {
    if (!isValid) return
    setError(null)
    setIsLoading(true)
    try {
      const payload: VehicleInfoPayload = {
        category_id: Number(categoryId),
        brand_id: Number(brandId),
        vehicle_name: unlisted ? customModel.trim() : selectedModel!.name,
        model_year: parseInt(modelYear, 10),
        number_plate: plate.trim().toUpperCase().replace(/\s/g, ''),
        color: color!,
        fuel_type: fuelType as VehicleInfoPayload['fuel_type'],
        seating_capacity: seating,
        luggage_capacity: luggage,
        ac_availability: ac,
      }
      if (!unlisted) payload.model_id = Number(modelId)
      if (registrationDate) payload.registration_date = registrationDate
      const result = await onboardingApi.saveVehicleInfo(payload)
      if (isEdit) {
        router.back()
      } else {
        updateDriver({ onboarding_step: result.next_step })
        router.push('/onboarding/documents')
      }
    } catch (err) {
      const data = axios.isAxiosError(err) ? (err.response?.data as { code?: string; fields?: Record<string, string[]> } | undefined) : undefined
      if (data?.code === 'DUPLICATE_ENTRY') setError('This number plate is already registered. Contact support if this is your vehicle.')
      else if (data?.code === 'VALIDATION_ERROR') setError(data.fields?.['number_plate']?.[0] ?? 'Please check your vehicle details.')
      else setError(getApiErrorMessage(err))
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
            : !modelOk ? (unlisted ? 'Enter your vehicle model name' : 'Select your vehicle model')
            : !color ? 'Select vehicle colour'
            : !fuelOk ? 'Select fuel type'
            : !plate ? 'Enter registration number'
            : plate && !isValidPlate(plate) ? 'Enter a valid registration number'
            : !modelYear ? 'Enter year of manufacture'
            : `Year must be between ${MIN_MODEL_YEAR} and ${MAX_MODEL_YEAR}`}
        </Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Button label={isEdit ? 'Save changes' : 'Continue'} onPress={handleContinue} loading={isLoading} disabled={!isValid} />
    </>
  )

  return (
    <OnboardingShell stepIndex={1} title="Vehicle Details" subtitle={isEdit ? 'Update your vehicle' : 'Progress is saved automatically'} hideProgress={isEdit} footer={footer}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Feather name="truck" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>Vehicle</Text>
        </View>
        <PickerField label="Brand" value={brandId} options={brands.map((b) => ({ value: Number(b.id), label: b.name }))} onSelect={(v) => void handleBrandChange(Number(v))} placeholder="Select brand" searchable={brands.length > 6} />
        <View style={styles.modelGroup}>
          {unlisted ? (
            <Field label="Model name">
              <TextField value={customModel} onChangeText={setCustomModel} placeholder="e.g. Swift Dzire" maxLength={100} />
            </Field>
          ) : (
            <PickerField label="Model" value={modelId} options={models.map((m) => ({ value: Number(m.id), label: m.name }))} onSelect={(v) => handleModelChange(Number(v))} placeholder={!brandId ? 'Select brand first' : 'Select model'} disabled={!brandId} searchable={models.length > 6} />
          )}
          {brandId && (!isEdit || unlisted) ? (
            <Pressable onPress={() => { setUnlisted((u) => !u); setModelId(null); setCategoryId(null) }} accessibilityRole="button" hitSlop={8} style={styles.unlistedLink}>
              <Text style={styles.unlistedText}>{unlisted ? 'Choose from the list instead' : "My model isn't listed"}</Text>
            </Pressable>
          ) : null}
        </View>
        <Field label="Vehicle Category">
          <View style={styles.categoryGrid}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => { if (!locked) setCategoryId(Number(c.id)) }}
                disabled={locked}
                style={({ pressed }) => [styles.categoryBtn, categoryId === Number(c.id) ? styles.categoryBtnActive : null, locked && categoryId !== Number(c.id) ? styles.categoryLocked : null, pressed ? styles.pressedScale : null]}
              >
                <VehicleIcon slug={c.slug} size={40} />
                <Text style={[styles.categoryText, categoryId === Number(c.id) ? styles.categoryTextActive : null]} numberOfLines={1}>{c.display_name}</Text>
                <Text style={styles.categorySeats}>{c.max_passengers} seats</Text>
              </Pressable>
            ))}
          </View>
          {locked ? <LockNote>Set by your model</LockNote> : unlisted ? <LockNote>Choose the closest. Our team will confirm it.</LockNote> : null}
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
          <ChipGroup columns={4} value={fuelType} onChange={setFuelType} options={fuelOptionsFor(selectedModel).map((f) => ({ value: f.value, label: f.label }))} />
        </Field>
        <Field label="Color">
          <ChipGroup value={color} onChange={setColor} options={VEHICLE_COLORS.map((c) => ({ value: c, label: c }))} />
        </Field>
        <View style={styles.specGroup}>
          <View style={styles.stepperRow}>
            <View style={styles.stepperCol}>
              <Field label="Seats"><Stepper value={seating} min={1} max={8} unit="seat" onChange={() => undefined} locked /></Field>
            </View>
            <View style={styles.stepperCol}>
              <Field label="Luggage Bags"><Stepper value={luggage} min={0} max={5} unit="bag" onChange={() => undefined} locked /></Field>
            </View>
          </View>
          <LockNote>Seats and luggage are fixed by the vehicle category.</LockNote>
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
  cardTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  categoryBtn: { flexBasis: '47%', flexGrow: 1, paddingVertical: 12, paddingHorizontal: spacing.xs, borderRadius: radii.lg, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surface2, alignItems: 'center', gap: spacing.xs },
  categoryBtnActive: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  categoryText: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold },
  categorySeats: { ...typography.caption, fontSize: 11, color: colors.ink400 },
  categoryTextActive: { color: colors.primaryDark },
  categoryLocked: { opacity: 0.45 },
  // A note that says "this is fixed": a small lock plus the reason, on the muted ink that still reads on the card surface.
  lockNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  lockNoteText: { ...typography.caption, color: colors.ink600, flexShrink: 1 },
  // The "not listed" link belongs to the model field above it, so they sit as one group with a tight gap.
  modelGroup: { gap: spacing.xs },
  unlistedLink: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  unlistedText: { ...typography.label, color: colors.primary, fontFamily: fonts.bold },
  specGroup: { gap: spacing.sm },
  stepperRow: { flexDirection: 'row', gap: spacing.md },
  stepperCol: { flex: 1 },
  acRow: { flexDirection: 'row', gap: spacing.sm },
  acBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface2, alignItems: 'center' },
  acBtnActive: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  acText: { ...typography.body, color: colors.ink600, fontFamily: fonts.bold },
  acTextActive: { color: colors.primary },
  pressedScale: { transform: [{ scale: 0.97 }] },
})
