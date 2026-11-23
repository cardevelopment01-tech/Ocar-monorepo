import { useCallback, useEffect, useRef, useState } from 'react'
import { parseOtp } from '../utils/otp'

/** The native retriever (packages/expo-sms-retriever), passed in so this package stays free of native modules. null = not available. */
export interface OtpRetriever {
  start(): Promise<boolean>
  stop(): void
  addListener(event: 'onSms', cb: (e: { message: string }) => void): { remove(): void }
}

/**
 * Android SMS auto-read. `arm()` BEFORE asking the server to send the code (so the SMS cannot beat the listener) and send
 * `autoRead: <its result>` with the request: the server only uses the auto-read wording when the phone is really listening.
 * When the SMS arrives, `onCode` gets the digits and `detected` turns true. Every failure just resolves false: manual entry and the
 * keyboard's own autofill keep working.
 */
export function useOtpAutoRead(retriever: OtpRetriever | null | undefined, onCode: (code: string) => void, length = 6) {
  const [detected, setDetected] = useState(false)
  const [listening, setListening] = useState(false)
  const subRef = useRef<{ remove(): void } | null>(null)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  const disarm = useCallback(() => {
    subRef.current?.remove()
    subRef.current = null
    setListening(false)
    try { retriever?.stop() } catch { /* nothing to stop */ }
  }, [retriever])

  const arm = useCallback(async (): Promise<boolean> => {
    if (!retriever) return false
    subRef.current?.remove()
    subRef.current = null
    setDetected(false)
    try {
      subRef.current = retriever.addListener('onSms', (e) => {
        const code = parseOtp(e.message, length)
        if (!code) return
        setDetected(true)
        setListening(false)
        onCodeRef.current(code)
      })
      const ok = await retriever.start()
      setListening(ok)
      if (!ok) { subRef.current.remove(); subRef.current = null }
      return ok
    } catch {
      subRef.current?.remove()
      subRef.current = null
      return false
    }
  }, [retriever, length])

  useEffect(() => disarm, [disarm])

  return { arm, disarm, detected, listening }
}

/** Seconds since `resetKey` last changed, while `active`; 0 when inactive. Drives the "taking longer than usual" state. */
export function useOtpWaitSeconds(active: boolean, resetKey: number): number {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    setSec(0)
    if (!active) return
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [active, resetKey])
  return sec
}
