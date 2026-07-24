interface AppError {
  code: string
  message: string
  httpStatus: number
}

export const AppErrors = {
  AUTH_OTP_EXPIRED: {
    code: 'AUTH_OTP_EXPIRED',
    message: 'OTP has expired',
    httpStatus: 401,
  },
  AUTH_OTP_INVALID: {
    code: 'AUTH_OTP_INVALID',
    message: 'Invalid OTP',
    httpStatus: 401,
  },
  AUTH_OTP_LOCKED: {
    code: 'AUTH_OTP_LOCKED',
    message: 'OTP verification locked due to too many failed attempts',
    httpStatus: 429,
  },
  AUTH_OTP_RATE_LIMITED: {
    code: 'AUTH_OTP_RATE_LIMITED',
    message: 'Too many OTP requests. Please wait before trying again',
    httpStatus: 429,
  },
  AUTH_TOKEN_INVALID: {
    code: 'AUTH_TOKEN_INVALID',
    message: 'Invalid authentication token',
    httpStatus: 401,
  },
  AUTH_TOKEN_EXPIRED: {
    code: 'AUTH_TOKEN_EXPIRED',
    message: 'Authentication token has expired',
    httpStatus: 401,
  },
  AUTH_UNAUTHORIZED: {
    code: 'AUTH_UNAUTHORIZED',
    message: 'Authentication required',
    httpStatus: 401,
  },
  AUTH_FORBIDDEN: {
    code: 'AUTH_FORBIDDEN',
    message: 'You do not have permission to perform this action',
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
  DRIVER_NOT_APPROVED: {
    code: 'DRIVER_NOT_APPROVED',
    message: 'Driver account is pending approval',
    httpStatus: 403,
  },
  DRIVER_SUSPENDED: {
    code: 'DRIVER_SUSPENDED',
    message: 'Driver account is suspended',
    httpStatus: 403,
  },
  LOW_WALLET_BALANCE: {
    code: 'LOW_WALLET_BALANCE',
    message: 'Wallet balance is below the minimum required to receive rides',
    httpStatus: 402,
  },
  DRIVER_SESSION_ACTIVE: {
    code: 'DRIVER_SESSION_ACTIVE',
    message: 'Driver already has an active session',
    httpStatus: 409,
  },
  RIDE_NO_DRIVERS: {
    code: 'RIDE_NO_DRIVERS',
    message: 'No drivers available in your area',
    httpStatus: 404,
  },
  RIDE_OTP_FAILED: {
    code: 'RIDE_OTP_FAILED',
    message: 'Invalid ride OTP',
    httpStatus: 401,
  },
  RIDE_OTP_LOCKED: {
    code: 'RIDE_OTP_LOCKED',
    message: 'Ride OTP locked due to too many failed attempts',
    httpStatus: 429,
  },
  RIDE_ALREADY_ACTIVE: {
    code: 'RIDE_ALREADY_ACTIVE',
    message: 'You already have an active ride',
    httpStatus: 409,
  },
  RIDE_NOT_FOUND: {
    code: 'RIDE_NOT_FOUND',
    message: 'Ride not found',
    httpStatus: 404,
  },
  RIDE_INVALID_STATUS: {
    code: 'RIDE_INVALID_STATUS',
    message: 'This action is not allowed in the current ride status',
    httpStatus: 422,
  },
  PAYMENT_DUPLICATE: {
    code: 'PAYMENT_DUPLICATE',
    message: 'Payment already exists for this ride',
    httpStatus: 409,
  },
  PAYMENT_NOT_FOUND: {
    code: 'PAYMENT_NOT_FOUND',
    message: 'Payment not found',
    httpStatus: 404,
  },
  WALLET_INSUFFICIENT: {
    code: 'WALLET_INSUFFICIENT',
    message: 'Insufficient wallet balance',
    httpStatus: 422,
  },
  WALLET_FROZEN: {
    code: 'WALLET_FROZEN',
    message: 'Wallet is frozen',
    httpStatus: 403,
  },
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    httpStatus: 422,
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    message: 'Resource not found',
    httpStatus: 404,
  },
  DUPLICATE_ENTRY: {
    code: 'DUPLICATE_ENTRY',
    message: 'Resource already exists',
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
} as const satisfies Record<string, AppError>
