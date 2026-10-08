import { useCallback, useEffect, useReducer, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  paymentReducer, initialPayment, isBusy, shouldPersist, pollDelayMs, environmentMatches,
  type PayKind, type PaymentState,
} from './paymentMachine'
import { confirmPayment, signHash, PaymentsUnavailableError, type SdkOrder } from './api'
import { startSdkPayment, sdkAvailable, type PayMode } from './payuSdk'

const OPEN_PAYMENT_KEY = 'ocar_driver_open_payment'
const BUILD_ENV = process.env['EXPO_PUBLIC_PAYU_ENV'] // 'prod' for production builds, else test

type Persisted = { kind: PayKind; txnId: string }

async function readOpen(): Promise<Persisted | null> {
  try {
    const raw = await AsyncStorage.getItem(OPEN_PAYMENT_KEY)
    const v = raw ? (JSON.parse(raw) as Persisted) : null
    return v && typeof v.txnId === 'string' && (v.kind === 'topup' || v.kind === 'package') ? v : null
  } catch { return null }
}

// Drives one in-app payment: create order -> native sheet -> server confirm. The
// machine (paymentMachine.ts) decides; this hook only runs the side effects.
// `onSettled` fires on every terminal state so the screen can re-fetch balances.
export function usePayment(onSettled: () => void) {
  const [state, dispatch] = useReducer(paymentReducer, initialPayment)
  const orderRef = useRef<SdkOrder | null>(null)
  const modeRef = useRef<PayMode | undefined>(undefined)
  const launched = useRef<string | null>(null)
  const stateRef = useRef<PaymentState>(state)
  stateRef.current = state
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled

  // Resume an unresolved payment after an app kill / crash mid-payment.
  useEffect(() => {
    void readOpen().then((open) => { if (open) dispatch({ type: 'RESUME', kind: open.kind, txnId: open.txnId }) })
  }, [])

  const start = useCallback((kind: PayKind, create: () => Promise<SdkOrder>, mode?: PayMode) => {
    // Only an idle machine starts; the reducer ignores a second START, but the
    // order request itself must not fire twice either.
    if (isBusy(stateRef.current)) return
    modeRef.current = mode
    dispatch({ type: 'START', kind })
    void (async () => {
      try {
        if (!sdkAvailable()) throw new PaymentsUnavailableError('sdk missing')
        const order = await create()
        if (!environmentMatches(BUILD_ENV, order.environment)) throw new PaymentsUnavailableError('environment mismatch')
        orderRef.current = order
        dispatch({ type: 'ORDER_READY', txnId: order.transactionId })
      } catch (err) {
        dispatch({ type: 'ORDER_FAILED', unavailable: err instanceof PaymentsUnavailableError })
      }
    })()
  }, [])

  // Open the native sheet exactly once per txn.
  useEffect(() => {
    if (state.phase !== 'sdk' || launched.current === state.txnId || !orderRef.current) return
    launched.current = state.txnId
    void startSdkPayment(orderRef.current, signHash, modeRef.current).then((exit) => dispatch({ type: 'SDK_EXIT', exit }))
  }, [state])

  // Confirm with the server (immediately, then with backoff while it is pending).
  useEffect(() => {
    if (state.phase !== 'confirming') return
    let stale = false
    const timer = setTimeout(() => {
      confirmPayment(state.txnId)
        .then((result) => { if (!stale) dispatch({ type: 'CONFIRM_RESULT', result }) })
        .catch(() => { if (!stale) dispatch({ type: 'CONFIRM_ERROR' }) })
    }, state.attempt === 0 ? 0 : pollDelayMs(state.attempt - 1))
    return () => { stale = true; clearTimeout(timer) }
  }, [state])

  // Keep the open txn only while its outcome is unknown.
  useEffect(() => {
    void (async () => {
      try {
        if (shouldPersist(state)) {
          await AsyncStorage.setItem(OPEN_PAYMENT_KEY, JSON.stringify({ kind: state.kind, txnId: state.txnId }))
        } else if (state.phase !== 'creating') {
          await AsyncStorage.removeItem(OPEN_PAYMENT_KEY)
        }
      } catch { /* storage unavailable: the webhook/sweep still credit */ }
    })()
    if (state.phase === 'credited' || state.phase === 'pending' || state.phase === 'failed' || state.phase === 'cancelled') {
      settledRef.current()
    }
  }, [state])

  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])
  return { state, start, reset, busy: isBusy(state) }
}
