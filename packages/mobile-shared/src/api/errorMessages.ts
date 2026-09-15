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
