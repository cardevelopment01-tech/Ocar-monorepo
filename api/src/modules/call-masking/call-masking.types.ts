export type CallerRole = 'user' | 'driver'

export type CallMaskingErrorCode =
  | 'MASKING_DISABLED'
  | 'CALL_NOT_AVAILABLE'
  | 'CALL_LIMIT_REACHED'
  | 'CALL_FAILED'

export class CallMaskingError extends Error {
  constructor(
    public code: CallMaskingErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CallMaskingError'
  }
}
