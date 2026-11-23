// What the OTP screen says while it waits for the SMS, and how a code is read out of one. Pure: no React Native, so the timing and the
// wording rules are tested.

/** The code in an auto-read SMS. The message has the code first ("<#> 123456 is your OTP ...") and the app's hash last, so take the first
 *  run of exactly `length` digits that is not part of a longer number (a 10 digit phone number, a year or the hash must not match).
 *  Null when there is none: the caller keeps manual entry. */
export function parseOtp(message: string | null | undefined, length = 6): string | null {
  if (!message) return null
  const m = new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`).exec(message)
  return m ? m[0] : null
}

/** After this long with no code the screen says so and tells the user where a held-back SMS usually is. */
export const OTP_SLOW_AFTER_SEC = 15

export type OtpWaitStatus =
  | { kind: 'none' }
  | { kind: 'waiting'; title: string }
  | { kind: 'slow'; title: string; hint: string }
  | { kind: 'detected'; title: string }
  | { kind: 'verifying'; title: string }
  | { kind: 'error'; title: string }
  | { kind: 'success'; title: string }

/**
 * The line under the code boxes, in priority order:
 *  - success:   the code was accepted
 *  - verifying: the code is being checked
 *  - error:     the last attempt failed; `error` is the sentence to show (the boxes are cleared, so this is the only trace)
 *  - detected:  the code was read from the SMS automatically
 *  - none:      the user is typing or has filled the boxes themselves
 *  - slow:      15 s without a code: still calm, says where a held-back SMS usually is. It only mentions resending once Resend is
 *               really available (it unlocks later than the hint appears), so it never points at a disabled button
 *  - waiting:   the SMS was sent and has not arrived yet; "reading automatically" when the phone is listening for it
 */
export function otpWaitStatus(p: {
  elapsedSec: number; autoReading: boolean; detected: boolean; typed: number
  canResend?: boolean; verifying?: boolean; success?: boolean; error?: string
}): OtpWaitStatus {
  if (p.success) return { kind: 'success', title: "You're in" }
  if (p.verifying) return { kind: 'verifying', title: 'Verifying your code' }
  if (p.error) return { kind: 'error', title: p.error }
  if (p.detected) return { kind: 'detected', title: 'Code detected' }
  if (p.typed > 0) return { kind: 'none' }
  if (p.elapsedSec >= OTP_SLOW_AFTER_SEC) {
    return {
      kind: 'slow',
      title: 'Taking longer than usual',
      hint: p.canResend
        ? 'Check your Spam or Blocked messages for a text from ODCARI, or resend the code.'
        : 'Check your Spam or Blocked messages for a text from ODCARI.',
    }
  }
  return { kind: 'waiting', title: p.autoReading ? 'Reading your SMS automatically' : 'Waiting for your code' }
}
