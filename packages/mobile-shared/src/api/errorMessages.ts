export function mapOtpErrorCode(code: string): string {
  switch (code) {
    case 'AUTH_OTP_EXPIRED':
      return 'Code expired, request a new one'
    case 'AUTH_OTP_INVALID':
      return 'Incorrect code'
    case 'AUTH_OTP_LOCKED':
    case 'AUTH_OTP_RATE_LIMITED':
      return 'Too many attempts, try again in a few minutes'
    default:
      return 'Something went wrong, please try again'
  }
}

// Codes confirmed against api/src/constants/errors.ts, not guessed.
export function mapBookingErrorCode(code: string): string {
  switch (code) {
    case 'RIDE_NO_DRIVERS':
      return 'No drivers available right now, try again in a moment'
    case 'RIDE_ALREADY_ACTIVE':
      return 'You already have an active ride'
    case 'RIDE_NOT_FOUND':
      return "Couldn't find that ride"
    case 'RIDE_INVALID_STATUS':
      return "That ride can't be updated right now"
    default:
      return 'Something went wrong, please try again'
  }
}

// Server-side validation (422 VALIDATION_ERROR, see api validate middleware) -> first field message,
// so a profile save can say "Invalid email address" instead of a generic failure.
export function mapSaveError(err: unknown, fallback = 'Could not save. Please try again.'): string {
  const data = (err as { response?: { data?: { fields?: Record<string, string[]> } } })?.response?.data
  const first = data?.fields ? Object.values(data.fields).flat()[0] : undefined
  return first ?? fallback
}

const API_CODE_MESSAGES: Record<string, string> = {
  DRIVER_ONBOARDING_INCOMPLETE: 'Finish your onboarding to go online.',
  DRIVER_NOT_APPROVED: "Your account is still under review. You can go online once it's approved.",
  DRIVER_SUSPENDED: 'Your account is suspended. Please contact Ocar support.',
  DRIVER_DOCS_REJECTED: 'A document was rejected, has expired or is awaiting review. Fix it in Documents to go online.',
  LOW_WALLET_BALANCE: 'Your wallet balance is too low. Recharge your wallet to continue.',
  WALLET_INSUFFICIENT: 'Your wallet balance is too low for this. Recharge your wallet to continue.',
  WALLET_FROZEN: 'Your wallet is frozen. Please contact Ocar support.',
  DRIVER_SESSION_ACTIVE: "You're already online on another device.",
  DAILY_CHECK_REQUIRED: "Complete today's selfie and plate check to go online.",
  CITY_NOT_ASSIGNED: 'Your operating city is not set yet. Contact support to get it assigned.',
  NO_VEHICLE: 'No vehicle is registered on your account. Add one in your profile.',
  RIDE_NO_DRIVERS: 'No drivers available right now, try again in a moment',
  RIDE_ALREADY_ACTIVE: 'You already have an active ride',
  RIDE_NOT_FOUND: "Couldn't find that ride",
  RIDE_INVALID_STATUS: "That ride can't be updated right now",
  RIDE_ALREADY_ASSIGNED: 'Another driver already accepted this ride.',
  RIDE_OTP_FAILED: "That code isn't right. Check it with the rider and try again.",
  RIDE_OTP_LOCKED: 'Too many incorrect codes. Try again in a few minutes.',
  AUTH_OTP_EXPIRED: 'Code expired, request a new one',
  AUTH_OTP_INVALID: 'Incorrect code',
  AUTH_OTP_LOCKED: 'Too many attempts, try again in a few minutes',
  AUTH_OTP_RATE_LIMITED: 'Too many attempts, try again in a few minutes',
  AUTH_SESSION_REPLACED: 'You were signed out because your account was used on another device.',
  AUTH_FORBIDDEN: "You don't have permission to do that.",
  FILE_TOO_LARGE: 'That file is too large. Choose one under 10 MB.',
  MAINTENANCE_MODE: 'Ocar is under maintenance right now. Please try again shortly.',
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  DUPLICATE_ENTRY: 'That already exists.',
}

// Turns any API failure into a sentence a person can act on: a known code's
// copy first, then the first field problem of a rejected form, then the
// server's own (safe, 4xx) message. Never axios's "Request failed with status
// code 403", and never a 5xx's internals.
export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as {
    isAxiosError?: boolean
    code?: string
    response?: { status?: number; data?: { code?: string; error?: string; fields?: Record<string, string[]> } }
  } | null
  if (!e?.isAxiosError) return fallback
  if (!e.response) {
    return e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT'
      ? 'This is taking too long. Check your connection and try again.'
      : "Can't reach Ocar. Check your internet connection and try again."
  }
  const { status = 0, data } = e.response
  const mapped = data?.code ? API_CODE_MESSAGES[data.code] : undefined
  if (mapped) return mapped
  if (status >= 500) return 'Ocar is having trouble right now. Please try again in a moment.'
  const firstField = data?.fields ? Object.values(data.fields).flat()[0] : undefined
  if (firstField) return firstField
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.'
  if (data?.code === 'VALIDATION_ERROR' && !data.error?.trim()) return fallback
  return data?.error && data.error !== 'Validation failed' ? data.error : fallback
}
