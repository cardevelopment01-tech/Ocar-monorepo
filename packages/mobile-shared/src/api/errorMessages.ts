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
