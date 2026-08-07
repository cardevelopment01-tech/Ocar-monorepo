export type CallerRole = 'user' | 'driver'

export type CallMaskingErrorCode =
  | 'MASKING_DISABLED'
  | 'NO_ACTIVE_MASK'
  | 'CALL_LIMIT_REACHED'
  | 'MASK_EXPIRED'

export class CallMaskingError extends Error {
  constructor(
    public code: CallMaskingErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CallMaskingError'
  }
}
