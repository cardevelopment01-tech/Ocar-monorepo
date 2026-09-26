import { useState, useEffect, useRef } from 'react'
import { Shield, CheckCircle2, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import OcarSpinner from '@/components/ui/OcarSpinner'
import SettingsHeader from '@/components/settings/SettingsHeader'
import SectionHeader from '@/components/documents/SectionHeader'
import DocGroupCard from '@/components/documents/DocGroupCard'
import DocPreviewModal from '@/components/documents/DocPreviewModal'
import { onboardingApi, type DocumentStatus } from '@/lib/onboarding-api'
import type { SlotDef, SlotState } from '@/components/documents/types'
import { DRIVER_GROUPS, VEHICLE_GROUPS, initSlotState, SLOT_LABELS } from '@/components/documents/groups'
import FieldError, { ShakeWrap, useShake } from '@/components/ui/FieldError'
import { useAuthStore } from '@/store/useAuthStore'

// Flat settings screen for an already-approved driver's documents.
// Every upload and the identity-number fields already save themselves
// (immediate PATCH/upload calls) — there's no "Continue" gate here,
// no forced order, no step to advance to.
//
// The alert card is keyed on any rejected slot, not on driver.status === 'docs_rejected' --
// a rejected optional doc (e.g. PUC) doesn't flip the account status (only a required-doc
// rejection does, via syncDriverStatusAfterDocChange), but it still deserves the same
// "here's exactly what's wrong" treatment as a required one.
export default function DriverDocuments() {
  const { driver } = useAuthStore()
  const [licenseNumber, setLicenseNumber] = useState('')
  const [aadhaarNumber, setAadhaarNumber] = useState('')
  const [identitySaved, setIdentitySaved] = useState(false)
  const [identityError, setIdentityError] = useState('')
  const [licenseError, setLicenseError] = useState('')
  const [aadhaarError, setAadhaarError] = useState('')
  const licenseShake = useShake()
  const aadhaarShake = useShake()

  const [slotState, setSlotState] = useState<Record<string, SlotState>>(initSlotState)
  const [validUntil, setValidUntil] = useState<Record<string, string>>({})
  const [isFetching, setIsFetching] = useState(true)
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    const load = async () => {
      try {
        const status: DocumentStatus = await onboardingApi.getDocumentStatus()
        if (status.identity.license_number) setLicenseNumber(status.identity.license_number)
        if (status.identity.aadhaar_number)  setAadhaarNumber(status.identity.aadhaar_number)
        if (status.identity.license_number && status.identity.aadhaar_number) setIdentitySaved(true)

        const merged: Record<string, SlotState> = initSlotState()
        for (const [k, v] of Object.entries({ ...status.photos, ...status.vehicle_docs })) {
          if (k in merged) {
            merged[k] = { state: v.uploaded ? 'done' : 'idle', url: v.url, error: null, docStatus: v.status, rejectionNote: v.rejection_note, rejectionCount: v.rejection_count ?? 0 }
          }
        }
        setSlotState(merged)
      } catch {
        // no saved data yet
      } finally {
        setIsFetching(false)
      }
    }
    void load()
  }, [])

  const setSlot = (key: string, patch: Partial<SlotState>) =>
    setSlotState(prev => ({ ...prev, [key]: { ...prev[key]!, ...patch } }))

  const handleFileSelect = async (slot: SlotDef, groupKey: string, file: File) => {
    setSlot(slot.key, { state: 'uploading', error: null, docStatus: null, rejectionNote: null })
    try {
      const expiry = validUntil[groupKey]
      const result = slot.isVehicle
        ? await onboardingApi.uploadVehicleDoc(file, slot.key, undefined, expiry)
        : await onboardingApi.uploadDriverDoc(file, slot.key, expiry)
      setSlot(slot.key, { state: 'done', url: result.file_url, error: null, docStatus: 'pending', rejectionNote: null, rejectionCount: 0 })
    } catch {
      setSlot(slot.key, { state: 'error', error: 'Upload failed. Tap to retry.' })
    }
  }

  const handleLicenseBlur = () => {
    if (licenseNumber && !/^[A-Z]{2}[A-Z0-9]{13,14}$/.test(licenseNumber)) {
      setLicenseError('Enter a valid licence number (e.g. OD0519910012345)')
      licenseShake.shake()
    } else {
      setLicenseError('')
    }
    void handleIdentityBlur()
  }

  const handleAadhaarBlur = () => {
    if (aadhaarNumber && aadhaarNumber.length !== 12) {
      setAadhaarError('Aadhaar number must be exactly 12 digits')
      aadhaarShake.shake()
    } else {
      setAadhaarError('')
    }
    void handleIdentityBlur()
  }

  const handleIdentityBlur = async () => {
    if (!/^[A-Z]{2}[A-Z0-9]{13,14}$/.test(licenseNumber) || aadhaarNumber.length !== 12) return
    setIdentityError('')
    try {
      await onboardingApi.saveIdentityNumbers({
        license_number: licenseNumber.trim().toUpperCase(),
        aadhaar_number: aadhaarNumber,
      })
      setIdentitySaved(true)
    } catch {
      setIdentityError("Couldn't save. Check your details.")
    }
  }

  const driverSectionDone  = DRIVER_GROUPS.filter(g => g.required).every(g => g.slots.every(s => slotState[s.key]?.state === 'done'))
  const vehicleSectionDone = VEHICLE_GROUPS.filter(g => g.required).every(g => g.slots.every(s => slotState[s.key]?.state === 'done'))

  // Named + reasoned, not just "a document was rejected", the escalation line matches the tiered
  // copy admin.service.ts sends the driver by push/SMS (2nd time: check carefully; 3rd+: support notified).
  const rejectedSlots = Object.entries(slotState).filter(([, v]) => v.docStatus === 'rejected')

  if (isFetching) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <OcarSpinner size={32} variant="color" />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col h-[100dvh] bg-bg text-text-primary">
        <SettingsHeader title="Documents" subtitle="Changes save automatically" />

        <main className="flex-1 overflow-y-auto px-5 pt-6 pb-6">
          <div className="space-y-3">

            {rejectedSlots.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-2xl border-2 border-accent-red/40 bg-surface-2 px-4 py-3.5 space-y-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="relative flex-shrink-0 h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                  </span>
                  <p className="text-sm font-bold text-text-primary">
                    {rejectedSlots.length === 1 ? '1 document needs your attention' : `${rejectedSlots.length} documents need your attention`}
                  </p>
                </div>
                {rejectedSlots.map(([key, v]) => (
                  <div key={key} className="pt-2 border-t border-accent-red/15 space-y-0.5">
                    <p className="text-sm font-bold text-text-primary">{SLOT_LABELS[key] ?? key}</p>
                    {v.rejectionNote && <p className="text-xs text-text-secondary leading-relaxed">{v.rejectionNote}</p>}
                    {v.rejectionCount >= 3 ? (
                      <p className="text-xs font-semibold text-accent-red">
                        Rejected {v.rejectionCount} times. Our support team has been notified. Reupload below, or contact support if you need help.
                      </p>
                    ) : v.rejectionCount === 2 ? (
                      <p className="text-xs font-semibold text-accent-red">This is the 2nd time. Check the requirements carefully before resubmitting.</p>
                    ) : null}
                  </div>
                ))}
                {driver?.status === 'docs_rejected' && (
                  <p className="text-[10px] text-text-muted pt-0.5">You can't go online again until this is fixed.</p>
                )}
              </motion.div>
            )}

            {/* Identity Numbers */}
            <div className="rounded-2xl border border-border bg-surface-2 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Shield size={15} className="text-primary" />
                  <h2 className="text-sm font-bold">Identity Numbers</h2>
                </div>
                {identitySaved && <CheckCircle2 size={15} className="text-green-500" />}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                    Driving Licence Number <span className="text-accent-red">*</span>
                  </label>
                  <ShakeWrap controls={licenseShake.controls}>
                    <input
                      className="input-dark w-full font-mono uppercase"
                      placeholder="OD0519910012345"
                      maxLength={16}
                      value={licenseNumber}
                      onChange={e => { setLicenseNumber(e.target.value.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16)); setIdentitySaved(false); setLicenseError('') }}
                      onBlur={handleLicenseBlur}
                    />
                  </ShakeWrap>
                  <FieldError message={licenseError} />
                </div>
                <div>
                  <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                    Aadhaar Number <span className="text-accent-red">*</span>
                  </label>
                  <p className="text-text-muted text-xs mb-1.5">12-digit number on your Aadhaar card</p>
                  <ShakeWrap controls={aadhaarShake.controls}>
                    <input
                      className="input-dark w-full font-mono tracking-widest"
                      placeholder="XXXXXXXXXXXX"
                      inputMode="numeric"
                      maxLength={12}
                      value={aadhaarNumber}
                      onChange={e => { setAadhaarNumber(e.target.value.replace(/\D/g, '').slice(0, 12)); setIdentitySaved(false); setAadhaarError('') }}
                      onBlur={handleAadhaarBlur}
                    />
                  </ShakeWrap>
                  <FieldError message={aadhaarError} />
                </div>
                {identityError && (
                  <div className="flex items-center gap-2 bg-accent-red/10 border border-accent-red/20 rounded-xl px-3 py-2.5">
                    <AlertCircle size={14} className="text-accent-red flex-shrink-0" />
                    <p className="text-accent-red text-xs font-medium">{identityError}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Driver Documents */}
            <SectionHeader icon="driver" label="Driver Documents" done={driverSectionDone} />
            {DRIVER_GROUPS.map(group => (
              <DocGroupCard
                key={group.groupKey}
                group={group}
                slotState={slotState}
                validUntil={validUntil[group.groupKey] ?? ''}
                fileRefs={fileRefs}
                onFileSelect={(slot, file) => void handleFileSelect(slot, group.groupKey, file)}
                onValidUntilChange={v => setValidUntil(prev => ({ ...prev, [group.groupKey]: v }))}
                onPreview={(url, label) => setPreview({ url, label })}
              />
            ))}

            {/* Vehicle Documents */}
            <SectionHeader icon="vehicle" label="Vehicle Documents" done={vehicleSectionDone} />
            {VEHICLE_GROUPS.map(group => (
              <DocGroupCard
                key={group.groupKey}
                group={group}
                slotState={slotState}
                validUntil={validUntil[group.groupKey] ?? ''}
                fileRefs={fileRefs}
                onFileSelect={(slot, file) => void handleFileSelect(slot, group.groupKey, file)}
                onValidUntilChange={v => setValidUntil(prev => ({ ...prev, [group.groupKey]: v }))}
                onPreview={(url, label) => setPreview({ url, label })}
              />
            ))}

          </div>
        </main>
      </div>
      {preview && <DocPreviewModal url={preview.url} label={preview.label} onClose={() => setPreview(null)} />}
    </>
  )
}
