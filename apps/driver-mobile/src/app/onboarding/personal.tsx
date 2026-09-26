import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import axios from 'axios'
import { Button, colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { onboardingApi, type PersonalInfoPayload } from '@/features/onboarding/api'
import { INDIA_STATES, INDIAN_LANGUAGES } from '@/features/onboarding/constants'
import { OnboardingShell } from '@/features/onboarding/components/OnboardingShell'
import { ChipGroup, Field, FieldError, PickerField, TextField } from '@/features/onboarding/components/FormPrimitives'
import { DateField } from '@/features/onboarding/components/DateField'

const VISIBLE_LANGS = 6

function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}`
}

const today = new Date()
const DOB_MAX = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate()).toISOString().slice(0, 10)
const DOB_MIN = new Date(today.getFullYear() - 70, today.getMonth(), today.getDate()).toISOString().slice(0, 10)

export default function PersonalDetailsScreen() {
  const router = useRouter()
  const updateDriver = useAuthStore((s) => s.updateDriver)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [showEmail, setShowEmail] = useState(false)
  const [gender, setGender] = useState<string | null>(null)
  const [dob, setDob] = useState('')
  const [address, setAddress] = useState('')
  const [state, setState] = useState<string | null>(null)
  const [city, setCity] = useState<string | null>(null)
  const [cityId, setCityId] = useState<number | undefined>(undefined)
  const [pincode, setPincode] = useState('')
  const [experience, setExperience] = useState<number | null>(null)
  const [emergency, setEmergency] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [showMoreLangs, setShowMoreLangs] = useState(false)
  const [odishaCities, setOdishaCities] = useState<{ id: number; name: string }[]>([])

  const [isFetching, setIsFetching] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emergencyError, setEmergencyError] = useState<string | null>(null)

  useEffect(() => {
    onboardingApi.getCities()
      .then((cities) => setOdishaCities(cities.filter((c) => c.state.toLowerCase() === 'odisha').map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const saved = await onboardingApi.getPersonalInfo()
        if (saved.full_name) setFullName(saved.full_name)
        if (saved.email) { setEmail(saved.email); setShowEmail(true) }
        if (saved.gender) setGender(saved.gender)
        if (saved.date_of_birth) setDob(saved.date_of_birth.toString().slice(0, 10))
        if (saved.residential_address) setAddress(saved.residential_address)
        if (saved.state) setState(saved.state)
        if (saved.city) setCity(saved.city)
        if (saved.pincode) setPincode(saved.pincode)
        if (saved.experience_years != null) setExperience(Number(saved.experience_years))
        if (saved.emergency_contact) setEmergency(saved.emergency_contact.replace(/^\+91/, ''))
        if (saved.languages_known?.length) setLanguages(saved.languages_known)
      } catch {
        // first-time driver, nothing saved yet
      } finally {
        setIsFetching(false)
      }
    }
    void load()
  }, [])

  const toggleLanguage = (lang: string) =>
    setLanguages((prev) => (prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]))

  const isValid =
    !!fullName.trim() && !!gender && !!dob && dob <= DOB_MAX && dob >= DOB_MIN &&
    address.trim().length >= 10 && !!state && !!city && /^\d{6}$/.test(pincode) &&
    experience !== null && /^[6-9]\d{9}$/.test(emergency) && languages.length > 0

  async function handleContinue() {
    if (!isValid) return
    setError(null)
    setEmergencyError(null)
    setIsLoading(true)
    try {
      const payload: PersonalInfoPayload = {
        full_name: fullName.trim(),
        gender: gender as PersonalInfoPayload['gender'],
        date_of_birth: dob,
        residential_address: address.trim(),
        state: state!.trim(),
        city: city!.trim(),
        pincode,
        experience_years: experience ?? 0,
        emergency_contact: formatPhone(emergency),
        languages_known: languages,
      }
      if (email.trim()) payload.email = email.trim()
      if (cityId !== undefined) payload.city_id = cityId
      const result = await onboardingApi.savePersonalInfo(payload)
      updateDriver({ onboarding_step: result.next_step })
      router.push('/onboarding/vehicle')
    } catch (err) {
      const data = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string; fields?: Record<string, string[]> } | undefined)
        : undefined
      const message = data?.fields?.['emergency_contact']?.[0] ?? data?.error
      if (message?.toLowerCase().includes('emergency contact')) {
        setEmergencyError(message)
      } else {
        setError(message ?? 'Something went wrong. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const firstSix = INDIAN_LANGUAGES.slice(0, VISIBLE_LANGS)
  const selectedNotInFirst = languages.filter((l) => !firstSix.includes(l))
  const displayLanguages = showMoreLangs ? INDIAN_LANGUAGES : [...new Set([...firstSix, ...selectedNotInFirst])]

  if (isFetching) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  const footer = (
    <>
      {!isValid ? (
        <Text style={styles.hint}>
          {!fullName.trim() ? 'Enter your full name to continue'
            : !gender ? 'Select your gender to continue'
            : !dob ? 'Enter your date of birth to continue'
            : dob > DOB_MAX || dob < DOB_MIN ? 'Driver must be 18–70 years old'
            : address.trim().length < 10 ? 'Enter your full residential address (min 10 characters)'
            : !state ? 'Select your state'
            : !city ? 'Select your city'
            : !/^\d{6}$/.test(pincode) ? 'Enter a valid 6-digit pincode'
            : experience === null ? 'Set your driving experience'
            : !/^[6-9]\d{9}$/.test(emergency) ? 'Enter a valid emergency contact number'
            : 'Select at least one language'}
        </Text>
      ) : null}
      {error ? <FieldError message={error} /> : null}
      <Button label="Continue" onPress={handleContinue} loading={isLoading} disabled={!isValid} />
    </>
  )

  return (
    <OnboardingShell stepIndex={0} title="Personal Details" footer={footer}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Feather name="user" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>About you</Text>
        </View>
        <Field label="Full Name (as on Aadhaar)">
          <TextField value={fullName} onChangeText={setFullName} placeholder="Ramesh Kumar" />
        </Field>
        <DateField label="Date of Birth" value={dob} onChange={setDob} minDate={DOB_MIN} maxDate={DOB_MAX} placeholder="Select your date of birth" />
        <Field label="Gender">
          <ChipGroup
            columns={3}
            value={gender}
            onChange={setGender}
            options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]}
          />
        </Field>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Feather name="map-pin" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>Where you live</Text>
        </View>
        <Field label="Residential Address">
          <TextField value={address} onChangeText={setAddress} placeholder="House No, Street, Locality" multiline numberOfLines={2} style={{ minHeight: 64, textAlignVertical: 'top' }} />
        </Field>
        <PickerField
          label="State"
          value={state}
          options={INDIA_STATES.map((s) => ({ value: s, label: s }))}
          onSelect={(v) => { setState(String(v)); setCity(null); setCityId(undefined) }}
          placeholder="Select state"
          searchable
        />
        {state === 'Odisha' && odishaCities.length > 0 ? (
          <PickerField
            label="City"
            value={city}
            options={odishaCities.map((c) => ({ value: c.name, label: c.name }))}
            onSelect={(v) => { setCity(String(v)); setCityId(odishaCities.find((c) => c.name === v)?.id) }}
            placeholder="Select city"
            searchable
          />
        ) : (
          <Field label="City">
            <TextField value={city ?? ''} onChangeText={(t) => { setCity(t); setCityId(undefined) }} placeholder={state ? 'Enter city' : 'Select state first'} editable={!!state} />
          </Field>
        )}
        <Field label="Pincode">
          <TextField value={pincode} onChangeText={(t) => setPincode(t.replace(/\D/g, '').slice(0, 6))} placeholder="751001" keyboardType="number-pad" maxLength={6} />
        </Field>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Feather name="truck" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>Driving & contact</Text>
        </View>
        <Field label="Driving Experience">
          <View style={styles.experienceRow}>
            <Pressable onPress={() => setExperience((v) => Math.max(0, (v ?? 0) - 1))} style={styles.stepBtn}>
              <Feather name="minus" size={14} color={colors.primary} />
            </Pressable>
            <Text style={styles.experienceText}>{experience === null ? 'Tap to set' : `${experience} ${experience === 1 ? 'yr' : 'yrs'}`}</Text>
            <Pressable onPress={() => setExperience((v) => Math.min(40, (v ?? 0) + 1))} style={styles.stepBtn}>
              <Feather name="plus" size={14} color={colors.primary} />
            </Pressable>
          </View>
        </Field>
        <Field label="Languages Known">
          <ChipGroup multiValue={languages} onChange={toggleLanguage} options={displayLanguages.map((l) => ({ value: l, label: l }))} />
          {!showMoreLangs && INDIAN_LANGUAGES.length > VISIBLE_LANGS ? (
            <Pressable onPress={() => setShowMoreLangs(true)}>
              <Text style={styles.moreLangs}>+{INDIAN_LANGUAGES.length - VISIBLE_LANGS} more</Text>
            </Pressable>
          ) : null}
        </Field>
        <Field label="Emergency Contact" hint="Only contacted in a safety emergency · never shared with riders">
          <View style={styles.phoneRow}>
            <Text style={styles.phonePrefix}>+91</Text>
            <TextField
              value={emergency}
              onChangeText={(t) => { setEmergency(t.replace(/\D/g, '').slice(0, 10)); setEmergencyError(null) }}
              placeholder="Family member's number"
              keyboardType="number-pad"
              maxLength={10}
              style={styles.phoneInput}
              // This is a family member's number, not the driver's own -- Android's
              // autofill/suggestion highlight (a distracting white-and-blue box that
              // doesn't match this field's pill styling) has nothing useful to offer
              // here and was rendering regardless of focus state.
              importantForAutofill="no"
              textContentType="none"
              autoComplete="off"
            />
          </View>
          <FieldError message={emergencyError} />
        </Field>
        {!showEmail ? (
          <Pressable onPress={() => setShowEmail(true)} style={styles.addEmailBtn}>
            <Feather name="plus" size={14} color={colors.primary} />
            <Text style={styles.addEmailText}>Add email address (optional)</Text>
          </Pressable>
        ) : (
          <Field label="Email Address">
            <TextField value={email} onChangeText={setEmail} placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" />
          </Field>
        )}
      </View>
    </OnboardingShell>
  )
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  hint: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginBottom: spacing.xs },
  experienceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface2, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minHeight: 52 },
  stepBtn: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  experienceText: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  moreLangs: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold, marginTop: spacing.xs },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface2, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  phonePrefix: { ...typography.body, color: colors.ink600, fontFamily: fonts.bold },
  // Cancels every visual layer `styles.input` (via ...shadows.card) puts on this
  // TextInput -- backgroundColor/borderWidth alone left the shadow/elevation
  // active, which on Android renders as an opaque white box with a shadow ring
  // floating inside phoneRow's own pill, since a transparent background can't
  // stop an elevated view from compositing its own backing layer.
  phoneInput: { flex: 1, backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0, shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  addEmailBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing.xs },
  addEmailText: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold },
})
