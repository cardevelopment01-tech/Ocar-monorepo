// Pure state machine for one in-app PayU payment. No React/RN imports so it is
// unit-testable (driver-mobile vitest is pure-logic only). The SDK callback is
// never trusted: every SDK exit, even a cancel, is followed by a server confirm.

export type PayKind = 'topup' | 'package'
export type SdkExit = 'success' | 'failure' | 'cancel' | 'error'
export type ConfirmResult = 'success' | 'failed' | 'pending'

export type PaymentState =
  | { phase: 'idle' }
  | { phase: 'creating'; kind: PayKind }
  | { phase: 'sdk'; kind: PayKind; txnId: string }
  | { phase: 'confirming'; kind: PayKind; txnId: string; attempt: number; exit: SdkExit | 'resume' }
  | { phase: 'credited'; kind: PayKind }
  | { phase: 'pending'; kind: PayKind; txnId: string } // paid-or-paying, server not sure yet
  | { phase: 'failed'; kind: PayKind; reason: 'order' | 'payment' | 'unavailable' }
  | { phase: 'cancelled'; kind: PayKind }

export type PaymentEvent =
  | { type: 'START'; kind: PayKind }
  | { type: 'ORDER_READY'; txnId: string }
  | { type: 'ORDER_FAILED'; unavailable?: boolean }
  | { type: 'SDK_EXIT'; exit: SdkExit }
  | { type: 'CONFIRM_RESULT'; result: ConfirmResult }
  | { type: 'CONFIRM_ERROR' } // network/5xx: we do not know the outcome
  | { type: 'RESUME'; kind: PayKind; txnId: string }
  | { type: 'RESET' }

// ~60 s of polling in total: 2 s, 3 s, 4 s ... capped at 8 s.
export const MAX_CONFIRM_ATTEMPTS = 10
export const pollDelayMs = (attempt: number): number => Math.min(2000 + attempt * 1000, 8000)

export const initialPayment: PaymentState = { phase: 'idle' }

export const isBusy = (s: PaymentState): boolean =>
  s.phase === 'creating' || s.phase === 'sdk' || s.phase === 'confirming'

export function paymentReducer(s: PaymentState, e: PaymentEvent): PaymentState {
  switch (e.type) {
    case 'START':
      // Double-tap safe: only an idle machine starts a payment.
      return s.phase === 'idle' ? { phase: 'creating', kind: e.kind } : s
    case 'ORDER_READY':
      return s.phase === 'creating' ? { phase: 'sdk', kind: s.kind, txnId: e.txnId } : s
    case 'ORDER_FAILED':
      return s.phase === 'creating' ? { phase: 'failed', kind: s.kind, reason: e.unavailable ? 'unavailable' : 'order' } : s
    case 'SDK_EXIT':
      return s.phase === 'sdk' ? { phase: 'confirming', kind: s.kind, txnId: s.txnId, attempt: 0, exit: e.exit } : s
    case 'RESUME':
      return s.phase === 'idle' ? { phase: 'confirming', kind: e.kind, txnId: e.txnId, attempt: 0, exit: 'resume' } : s
    case 'CONFIRM_RESULT': {
      if (s.phase !== 'confirming') return s
      if (e.result === 'success') return { phase: 'credited', kind: s.kind }
      if (e.result === 'failed') return { phase: 'failed', kind: s.kind, reason: 'payment' }
      // Still pending at the server.
      if (s.exit === 'cancel') return { phase: 'cancelled', kind: s.kind } // user backed out; nothing captured
      return retry(s)
    }
    case 'CONFIRM_ERROR':
      return s.phase === 'confirming' ? retry(s) : s
    case 'RESET':
      return s.phase === 'idle' || isBusy(s) ? s : initialPayment
  }
}

function retry(s: Extract<PaymentState, { phase: 'confirming' }>): PaymentState {
  return s.attempt + 1 >= MAX_CONFIRM_ATTEMPTS
    ? { phase: 'pending', kind: s.kind, txnId: s.txnId }
    : { ...s, attempt: s.attempt + 1 }
}

// A txn id must survive an app kill only while the outcome is unknown.
export const shouldPersist = (s: PaymentState): s is Extract<PaymentState, { txnId: string }> =>
  s.phase === 'sdk' || s.phase === 'confirming' || s.phase === 'pending'

// The server says which PayU environment it signs for ('0' live, '1' test). A
// build for one must never talk to the other.
export const environmentMatches = (buildEnv: string | undefined, serverEnvironment: string): boolean =>
  (buildEnv === 'prod' && serverEnvironment === '0') || (buildEnv !== 'prod' && serverEnvironment === '1')

export const MIN_TOPUP = 100
export const MAX_TOPUP = 50_000
export const topupAmountError = (amount: number): string | null =>
  !Number.isFinite(amount) || amount < MIN_TOPUP ? `Minimum top-up is ₹${MIN_TOPUP}`
    : amount > MAX_TOPUP ? `Maximum top-up is ₹${MAX_TOPUP.toLocaleString('en-IN')}`
    : !Number.isInteger(amount) ? 'Enter a whole rupee amount' : null
