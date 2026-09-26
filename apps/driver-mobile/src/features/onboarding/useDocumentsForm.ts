import { useEffect, useState } from 'react'
import { onboardingApi, type DocumentStatus, type PickedFile } from './api'
import { DRIVER_DOC_GROUPS, VEHICLE_DOC_GROUPS, ALL_DOC_KEYS } from './constants'

export type SlotState = { state: 'idle' | 'uploading' | 'done' | 'error'; url: string | null; docStatus: string | null; rejectionNote: string | null; rejectionCount: number; error: string | null }

function initSlotState(): Record<string, SlotState> {
  return Object.fromEntries(ALL_DOC_KEYS.map((k) => [k, { state: 'idle' as const, url: null, docStatus: null, rejectionNote: null, rejectionCount: 0, error: null }]))
}

const VEHICLE_DOC_KEYS = new Set(VEHICLE_DOC_GROUPS.flatMap((g) => g.slots.map((s) => s.key)))
const ALL_LABELS: Record<string, string> = Object.fromEntries(
  [...DRIVER_DOC_GROUPS, ...VEHICLE_DOC_GROUPS].flatMap((g) => g.slots.map((s) => [s.key, s.slotLabel ? `${g.label} (${s.slotLabel})` : g.label]))
)

export type RejectedDoc = { key: string; label: string; note: string | null; count: number }

/**
 * Identity-number and document-upload state shared by the onboarding Documents step and the
 * standalone Documents screen, so both use the same fields and upload logic.
 */
export function useDocumentsForm() {
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
          if (k in merged) {
            merged[k] = { state: v.uploaded ? 'done' : 'idle', url: v.url, docStatus: v.status, rejectionNote: v.rejection_note, rejectionCount: v.rejection_count ?? 0, error: null }
          }
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
      // Resubmission after a rejection re-queues for review, it does not clear the block by itself
      // (an admin has to re-approve), so the slot goes to 'pending', not back to a clean 'done'.
      setSlot(key, { state: 'done', url: result.file_url, docStatus: 'pending', rejectionNote: null, rejectionCount: 0, error: null })
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

  async function saveIdentityIfNeeded(): Promise<boolean> {
    if (identitySaved || !identityFilled) return true
    setIsSaving(true)
    try {
      await onboardingApi.saveIdentityNumbers({ license_number: licenseNumber.trim().toUpperCase(), aadhaar_number: aadhaarNumber })
      setIdentitySaved(true)
      return true
    } catch {
      setIdentityError("Couldn't save. Check your details.")
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const rejectedDocs: RejectedDoc[] = ALL_DOC_KEYS
    .filter((k) => slotState[k]?.docStatus === 'rejected')
    .map((k) => ({ key: k, label: ALL_LABELS[k] ?? k, note: slotState[k]?.rejectionNote ?? null, count: slotState[k]?.rejectionCount ?? 0 }))
  const pendingCount = ALL_DOC_KEYS.filter((k) => slotState[k]?.docStatus === 'pending').length

  return {
    isFetching, isSaving,
    licenseNumber, setLicenseNumber: (t: string) => { setLicenseNumber(t.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16)); setIdentitySaved(false) },
    aadhaarNumber, setAadhaarNumber: (t: string) => { setAadhaarNumber(t.replace(/\D/g, '').slice(0, 12)); setIdentitySaved(false) },
    identitySaved, identityError, trySaveIdentity, saveIdentityIfNeeded,
    slotState, validUntil, setValidUntil, handlePick,
    allDocsUploaded, allExpiriesFilled, identityFilled, canContinue,
    rejectedDocs, pendingCount,
    vehicleDocKeys: VEHICLE_DOC_KEYS,
  }
}

export type DocumentsForm = ReturnType<typeof useDocumentsForm>
