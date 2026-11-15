// Pure rules for the "upload a document for the driver" drawer.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

// Same list the review modal uses: these never expire, so no date is asked for.
export const NO_EXPIRY_DOC_TYPES = new Set([
  'profile_photo', 'aadhaar_front', 'aadhaar_back', 'driving_license_back', 'vehicle_rc_front', 'vehicle_rc_back',
])

export const REASON_PRESETS = [
  'Driver could not upload',
  'Poor photo quality',
  'Sent by WhatsApp or email',
  'Other',
]

export const MIN_REASON_LENGTH = 5

export function needsExpiry(docType: string): boolean {
  return !NO_EXPIRY_DOC_TYPES.has(docType)
}

// Earliest allowed expiry: tomorrow, local calendar day (a doc valid "until today" is stale tomorrow).
export function minExpiryIso(now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

export function validateUploadFile(file: { size: number; type: string }): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Choose a JPG, PNG or PDF file.'
  if (file.size > MAX_UPLOAD_BYTES) return 'That file is over 10 MB. Choose a smaller one.'
  if (file.size === 0) return 'That file is empty.'
  return null
}

export interface UploadFormState {
  file: File | null
  expiry: string
  reason: string
  confirmSelfie: boolean
}

/** What blocks the two submit buttons. `approve` also needs the verified expiry. */
export function uploadBlocker(
  docType: string,
  s: UploadFormState,
  approve: boolean,
  now = new Date(),
): string | null {
  if (!s.file) return 'Choose a file first.'
  if (s.reason.trim().length < MIN_REASON_LENGTH) return 'Say why you are uploading this for the driver.'
  if (docType === 'profile_photo' && !s.confirmSelfie) return 'Confirm the reference selfie change.'
  if (approve && needsExpiry(docType) && s.expiry < minExpiryIso(now)) return 'Enter an expiry date after today to approve.'
  return null
}
