interface AppError {
  code: string
  message: string
  httpStatus: number
}

export const AppErrors = {
  AUTH_OTP_EXPIRED: {
    code: 'AUTH_OTP_EXPIRED',
    message: 'That code has expired. Request a new one',
    httpStatus: 401,
  },
  AUTH_OTP_INVALID: {
    code: 'AUTH_OTP_INVALID',
    message: 'That code is incorrect. Check it and try again',
    httpStatus: 401,
  },
  AUTH_OTP_LOCKED: {
    code: 'AUTH_OTP_LOCKED',
    message: 'Too many incorrect attempts. Try again in a few minutes',
    httpStatus: 429,
  },
  AUTH_OTP_RATE_LIMITED: {
    code: 'AUTH_OTP_RATE_LIMITED',
    message: 'Too many code requests. Please wait a few minutes and try again',
    httpStatus: 429,
  },
  AUTH_TOKEN_INVALID: {
    code: 'AUTH_TOKEN_INVALID',
    message: 'Your session is not valid. Please sign in again',
    httpStatus: 401,
  },
  AUTH_SESSION_REPLACED: {
    code: 'AUTH_SESSION_REPLACED',
    message: 'You were logged out because your account was signed in on another device',
    httpStatus: 401,
  },
  AUTH_TOKEN_EXPIRED: {
    code: 'AUTH_TOKEN_EXPIRED',
    message: 'Your session has expired. Please sign in again',
    httpStatus: 401,
  },
  AUTH_UNAUTHORIZED: {
    code: 'AUTH_UNAUTHORIZED',
    message: 'Authentication required',
    httpStatus: 401,
  },
  AUTH_FORBIDDEN: {
    code: 'AUTH_FORBIDDEN',
    message: 'You do not have permission to do that',
    httpStatus: 403,
  },
  TOTP_SETUP_REQUIRED: {
    code: 'TOTP_SETUP_REQUIRED',
    message: 'Two-factor authentication setup is required for this role',
    httpStatus: 403,
  },
  TOTP_NO_PENDING_SETUP: {
    code: 'TOTP_NO_PENDING_SETUP',
    message: 'No pending two-factor setup found — start setup again',
    httpStatus: 422,
  },
  TOTP_INVALID_CODE: {
    code: 'TOTP_INVALID_CODE',
    message: 'Invalid or expired code',
    httpStatus: 401,
  },
  TOTP_INVALID_PENDING_TOKEN: {
    code: 'TOTP_INVALID_PENDING_TOKEN',
    message: 'This verification session has expired — please log in again',
    httpStatus: 401,
  },
  DRIVER_ONBOARDING_INCOMPLETE: {
    code: 'DRIVER_ONBOARDING_INCOMPLETE',
    message: 'Finish your onboarding to continue',
    httpStatus: 403,
  },
  DRIVER_NOT_APPROVED: {
    code: 'DRIVER_NOT_APPROVED',
    message: 'Your account is still under review. You can go online once it is approved',
    httpStatus: 403,
  },
  DRIVER_SUSPENDED: {
    code: 'DRIVER_SUSPENDED',
    message: 'Your account is suspended. Please contact Ocar support',
    httpStatus: 403,
  },
  DRIVER_BANNED: {
    code: 'DRIVER_BANNED',
    message: 'Your driver account has been deactivated. Please contact Ocar support',
    httpStatus: 403,
  },
  DRIVER_DOCS_REJECTED: {
    code: 'DRIVER_DOCS_REJECTED',
    message: 'One or more of your documents was rejected, has expired or is awaiting review — please fix or wait for approval to continue',
    httpStatus: 403,
  },
  LOW_WALLET_BALANCE: {
    code: 'LOW_WALLET_BALANCE',
    message: 'Your wallet balance is too low to receive rides. Recharge your wallet to continue',
    httpStatus: 402,
  },
  DRIVER_SESSION_ACTIVE: {
    code: 'DRIVER_SESSION_ACTIVE',
    message: 'You are already online on another device',
    httpStatus: 409,
  },
  RIDE_NO_DRIVERS: {
    code: 'RIDE_NO_DRIVERS',
    message: 'No drivers are available nearby right now. Please try again in a moment',
    httpStatus: 404,
  },
  RIDE_OTP_FAILED: {
    code: 'RIDE_OTP_FAILED',
    message: 'That ride code is incorrect. Check it and try again',
    httpStatus: 401,
  },
  RIDE_OTP_LOCKED: {
    code: 'RIDE_OTP_LOCKED',
    message: 'Too many incorrect ride codes. Try again in 15 minutes',
    httpStatus: 429,
  },
  RIDE_ALREADY_ACTIVE: {
    code: 'RIDE_ALREADY_ACTIVE',
    message: 'You already have an active ride',
    httpStatus: 409,
  },
  RIDE_NOT_FOUND: {
    code: 'RIDE_NOT_FOUND',
    message: 'We could not find that ride',
    httpStatus: 404,
  },
  RIDE_INVALID_STATUS: {
    code: 'RIDE_INVALID_STATUS',
    message: 'This is not possible at this stage of the ride',
    httpStatus: 422,
  },
  PAYMENT_DUPLICATE: {
    code: 'PAYMENT_DUPLICATE',
    message: 'This ride has already been paid for',
    httpStatus: 409,
  },
  PAYMENT_NOT_FOUND: {
    code: 'PAYMENT_NOT_FOUND',
    message: 'We could not find that payment',
    httpStatus: 404,
  },
  WALLET_INSUFFICIENT: {
    code: 'WALLET_INSUFFICIENT',
    message: 'Your wallet balance is too low. Recharge your wallet to continue',
    httpStatus: 422,
  },
  WALLET_FROZEN: {
    code: 'WALLET_FROZEN',
    message: 'Your wallet is frozen. Please contact Ocar support',
    httpStatus: 403,
  },
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    httpStatus: 422,
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    message: 'We could not find what you were looking for',
    httpStatus: 404,
  },
  DUPLICATE_ENTRY: {
    code: 'DUPLICATE_ENTRY',
    message: 'This already exists',
    httpStatus: 409,
  },
  ADMIN_INVITE_DUPLICATE: {
    code: 'ADMIN_INVITE_DUPLICATE',
    message: 'A pending invite already exists for this email',
    httpStatus: 409,
  },
  ADMIN_INVITE_INVALID: {
    code: 'ADMIN_INVITE_INVALID',
    message: 'This invite link is invalid, expired, or already used',
    httpStatus: 400,
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    httpStatus: 500,
  },
  SERVICE_UNAVAILABLE: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Ocar is having a temporary problem. Please try again in a moment',
    httpStatus: 503,
  },
  MAINTENANCE_MODE: {
    code: 'MAINTENANCE_MODE',
    message: 'Ocar is under maintenance right now. Please try again shortly',
    httpStatus: 503,
  },
} as const satisfies Record<string, AppError>
