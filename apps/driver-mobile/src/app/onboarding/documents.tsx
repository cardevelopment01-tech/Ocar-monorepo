import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { onboardingApi, type DocumentStatus, type PickedFile } from '@/features/onboarding/api'
import { DRIVER_DOC_GROUPS, VEHICLE_DOC_GROUPS, ALL_DOC_KEYS } from '@/features/onboarding/constants'
import { OnboardingShell } from '@/features/onboarding/components/OnboardingShell'
import { Field, FieldError, TextField } from '@/features/onboarding/components/FormPrimitives'
import { DateField } from '@/features/onboarding/components/DateField'
import { DocSlot, type DocSlotState } from '@/features/onboarding/components/DocSlot'

type SlotState = { state: DocSlotState; url: string | null; docStatus: string | null; rejectionNote: string | null; error: string | null }

function initSlotState(): Record<string, SlotState> {
  return Object.fromEntries(ALL_DOC_KEYS.map((k) => [k, { state: 'idle' as DocSlotState, url: null, docStatus: null, rejectionNote: null, error: null }]))
}

const VEHICLE_DOC_KEYS = new Set(VEHICLE_DOC_GROUPS.flatMap((g) => g.slots.map((s) => s.key)))

export default function DocumentsScreen() {
  const router = useRouter()

  const [licenseNumber, setLicenseNumber] = useState('')
  const [aadhaarNumber, setAadhaarNumber] = useState('')
  const [identitySaved, setIdentitySaved] = useState(false)
  const [identityError, setIdentityError] = useState('')

  const [slotState, setSlotState] = useState<Record<string, SlotState>>(initSlotState)
  const [validUntil, setValidUntil] = useState<Record<string, string>>({})
  const [isFetching, setIsFetching] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const status: DocumentStatus = await onboardingApi.getDocumentStatus()
        if (status.identity.license_number) setLicenseNumber(status.identity.license_number)
        if (status.identity.aadhaar_number) setAadhaarNumber(status.identity.aadhaar_number)
        if (status.identity.license_number && status.identity.aadhaar_number) setIdentitySaved(true)

        const merged = initSlotState()
        for (const [k, v] of Object.entries({ ...status.photos, ...status.vehicle_docs })) {
          if (k in merged) merged[k] = { state: v.uploaded ? 'done' : 'idle', url: v.url, docStatus: v.status, rejectionNote: v.rejection_note, error: null }
        }
        setSlotState(merged)
      } catch {
        // first visit, start fresh
      } finally {
        setIsFetching(false)
      }
    }
    void load()
  }, [])

  function setSlot(key: string, patch: Partial<SlotState>) {
    setSlotState((prev) => ({ ...prev, [key]: { ...prev[key]!, ...patch } }))
  }

  async function handlePick(key: string, groupKey: string, isVehicle: boolean, file: PickedFile) {
    setSlot(key, { state: 'uploading', error: null, docStatus: null, rejectionNote: null })
    try {
      const expiry = validUntil[groupKey]
      const result = isVehicle
        ? await onboardingApi.uploadVehicleDoc(file, key, undefined, expiry)
        : await onboardingApi.uploadDriverDoc(file, key, expiry)
      setSlot(key, { state: 'done', url: result.file_url, docStatus: 'pending', rejectionNote: null, error: null })
    } catch {
      setSlot(key, { state: 'error', error: 'Upload failed. Tap to retry.' })
    }
  }

  async function trySaveIdentity() {
    if (!/^[A-Z]{2}[A-Z0-9]{13,14}$/.test(licenseNumber) || aadhaarNumber.length !== 12) return
    setIdentityError('')
    try {
      await onboardingApi.saveIdentityNumbers({ license_number: licenseNumber.trim().toUpperCase(), aadhaar_number: aadhaarNumber })
      setIdentitySaved(true)
    } catch {
      setIdentityError("Couldn't save. Check your details.")
    }
  }

  const requiredDriverKeys = DRIVER_DOC_GROUPS.flatMap((g) => g.slots.map((s) => s.key))
  const requiredVehicleKeys = VEHICLE_DOC_GROUPS.filter((g) => g.required).flatMap((g) => g.slots.map((s) => s.key))
  const requiredKeys = [...requiredDriverKeys, ...requiredVehicleKeys]
  const allDocsUploaded = requiredKeys.every((k) => slotState[k]?.state === 'done')
  const requiredExpiryGroups = [...DRIVER_DOC_GROUPS, ...VEHICLE_DOC_GROUPS].filter((g) => g.required && g.hasExpiry && g.expiryRequired)
  const allExpiriesFilled = requiredExpiryGroups.every((g) => !!validUntil[g.groupKey])
  const identityFilled = /^[A-Z]{2}[A-Z0-9]{13,14}$/.test(licenseNumber) && aadhaarNumber.length === 12
  const canContinue = allDocsUploaded && allExpiriesFilled && (identitySaved || identityFilled)

  async function handleContinue() {
    if (!identitySaved && identityFilled) {
      setIsSaving(true)
      try {
        await onboardingApi.saveIdentityNumbers({ license_number: licenseNumber.trim().toUpperCase(), aadhaar_number: aadhaarNumber })
        setIdentitySaved(true)
      } catch {
        setIdentityError("Couldn't save. Check your details.")
        setIsSaving(false)
        return
      }
      setIsSaving(false)
    }
    router.push('/onboarding/selfie')
  }

  if (isFetching) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  const missingHint = !identityFilled
    ? 'Enter your licence and Aadhaar numbers'
    : !allDocsUploaded
      ? 'Upload all required documents to continue'
      : !allExpiriesFilled
        ? `Set expiry date for: ${requiredExpiryGroups.filter((g) => !validUntil[g.groupKey]).map((g) => g.label).join(', ')}`
        : ''

  const footer = (
    <>
      {!canContinue && missingHint ? <Text style={styles.hint}>{missingHint}</Text> : null}
      <Pressable onPress={() => void handleContinue()} disabled={!canContinue || isSaving} style={[styles.continueBtn, (!canContinue || isSaving) ? styles.disabled : null]}>
        {isSaving ? <ActivityIndicator color={colors.inkInverse} /> : <Text style={styles.continueText}>Continue to Selfie</Text>}
      </Pressable>
    </>
  )

  return (
    <OnboardingShell stepIndex={2} title="Documents" footer={footer}>
      <View style={styles.identityCard}>
        <View style={styles.cardHeader}>
          <Feather name="shield" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>Identity Numbers</Text>
          {identitySaved ? <Feather name="check-circle" size={15} color={colors.success} /> : null}
        </View>
        <Field label="Driving Licence Number">
          <TextField
            value={licenseNumber}
            onChangeText={(t) => { setLicenseNumber(t.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16)); setIdentitySaved(false) }}
            onBlur={trySaveIdentity}
            placeholder="OD0519910012345"
            autoCapitalize="characters"
            maxLength={16}
          />
        </Field>
        <Field label="Aadhaar Number" hint="12-digit number on your Aadhaar card">
          <TextField
            value={aadhaarNumber}
            onChangeText={(t) => { setAadhaarNumber(t.replace(/\D/g, '').slice(0, 12)); setIdentitySaved(false) }}
            onBlur={trySaveIdentity}
            placeholder="XXXXXXXXXXXX"
            keyboardType="number-pad"
            maxLength={12}
          />
        </Field>
        <FieldError message={identityError} />
      </View>

      <Text style={styles.sectionLabel}>DRIVER DOCUMENTS</Text>
      {DRIVER_DOC_GROUPS.map((group) => (
        <View key={group.groupKey} style={styles.groupCard}>
          <Text style={styles.groupLabel}>{group.label}</Text>
          {group.slots.map((slot) => (
            <DocSlot
              key={slot.key}
              label={slot.slotLabel || group.label}
              state={slotState[slot.key]?.state ?? 'idle'}
              thumbnailUrl={slotState[slot.key]?.url ?? null}
              docStatus={slotState[slot.key]?.docStatus}
              rejectionNote={slotState[slot.key]?.rejectionNote}
              error={slotState[slot.key]?.error}
              onPick={(file) => void handlePick(slot.key, group.groupKey, false, file)}
            />
          ))}
          {group.hasExpiry ? (
            <DateField label="Valid Until" value={validUntil[group.groupKey] ?? ''} onChange={(v) => setValidUntil((prev) => ({ ...prev, [group.groupKey]: v }))} placeholder="Select expiry date" />
          ) : null}
        </View>
      ))}

      <Text style={styles.sectionLabel}>VEHICLE DOCUMENTS</Text>
      {VEHICLE_DOC_GROUPS.map((group) => (
        <View key={group.groupKey} style={styles.groupCard}>
          <View style={styles.groupHeaderRow}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {!group.required ? <Text style={styles.optionalBadge}>Optional</Text> : null}
          </View>
          {group.slots.map((slot) => (
            <DocSlot
              key={slot.key}
              label={slot.slotLabel || group.label}
              state={slotState[slot.key]?.state ?? 'idle'}
              thumbnailUrl={slotState[slot.key]?.url ?? null}
              docStatus={slotState[slot.key]?.docStatus}
              rejectionNote={slotState[slot.key]?.rejectionNote}
              error={slotState[slot.key]?.error}
              onPick={(file) => void handlePick(slot.key, group.groupKey, VEHICLE_DOC_KEYS.has(slot.key), file)}
            />
          ))}
          {group.hasExpiry ? (
            <DateField label="Valid Until" value={validUntil[group.groupKey] ?? ''} onChange={(v) => setValidUntil((prev) => ({ ...prev, [group.groupKey]: v }))} placeholder="Select expiry date" />
          ) : null}
        </View>
      ))}
    </OnboardingShell>
  )
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  hint: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginBottom: spacing.xs },
  continueBtn: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 8, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  continueText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
  identityCard: { backgroundColor: colors.surface2, borderRadius: radii.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: { ...typography.body, color: colors.ink900, fontWeight: '700', flex: 1 },
  sectionLabel: { ...typography.caption, color: colors.ink400, fontWeight: '700', letterSpacing: 1, marginTop: spacing.sm },
  groupCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupLabel: { ...typography.body, color: colors.ink900, fontWeight: '700' },
  optionalBadge: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
})
