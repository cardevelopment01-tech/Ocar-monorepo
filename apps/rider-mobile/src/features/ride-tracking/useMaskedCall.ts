import { useEffect, useRef, useState } from 'react'
import { getApiErrorMessage } from '@ocar/mobile-shared'
import { triggerMaskedCall } from './api'

// Server codes from api/src/modules/call-masking (409) + the per-ride rate limiter (429), in plain words.
export function callErrorMessage(err: unknown, firstName: string): string {
  const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
  switch (code) {
    case 'MASKING_DISABLED':
    case 'CALL_NOT_AVAILABLE':
      return `Calling isn't available right now. You can message ${firstName} instead.`
    case 'CALL_LIMIT_REACHED':
      return `You've used all the call attempts for this ride. Message ${firstName} instead.`
    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many call attempts. Wait a minute and try again.'
    case 'CALL_FAILED':
      return "We couldn't start the call. Please try again."
    default:
      return getApiErrorMessage(err, 'Could not connect the call')
  }
}

// The call is a two-leg IVR: our API asks BulkSMSPlans, which rings THIS phone first and, once it is picked up,
// rings the driver and bridges the two. The API only confirms "request accepted" (no answered/connected webhook),
// so the honest states are: connecting (request in flight) -> ringing (we are calling you) -> idle again.
// One hook for every place that offers a call button (driver card, chat header), so they behave identically.
export function useMaskedCall(rideId: string, canCall: boolean, firstName: string) {
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'ringing'>('idle')
  const [callError, setCallError] = useState<string | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  async function handleCall() {
    if (phase !== 'idle' || !canCall) return
    setPhase('connecting')
    setCallError(null)
    try {
      await triggerMaskedCall(rideId)
      setPhase('ringing')
      // Each extra tap re-dials both parties and burns the ride's call cap, so hold the button while the IVR works.
      timers.current.push(setTimeout(() => setPhase('idle'), 20000))
    } catch (err) {
      setCallError(callErrorMessage(err, firstName))
      timers.current.push(setTimeout(() => setCallError(null), 6000))
      setPhase('idle')
    }
  }
  return { phase, callError, handleCall }
}
