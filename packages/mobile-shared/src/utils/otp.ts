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

/**
 * The line under the code boxes.
 *  - detected: the code was read from the SMS automatically (shown until the screen moves on)
 *  - waiting:  the SMS was sent and has not arrived yet, said calmly; "reading automatically" when the phone is listening for it
 *  - slow:     15 s without a code: still calm, but now says where to look (the SMS may have been filed as spam or blocked) and that
 *              Resend is the way out, without blaming the user or the network
 *  - none:     the user is typing or has filled the boxes themselves
 */
export function otpWaitStatus(p: { elapsedSec: number; autoReading: boolean; detected: boolean; typed: number }): OtpWaitStatus {
  if (p.detected) return { kind: 'detected', title: 'Code detected' }
  if (p.typed > 0) return { kind: 'none' }
  if (p.elapsedSec >= OTP_SLOW_AFTER_SEC) {
    return { kind: 'slow', title: 'Taking longer than usual', hint: 'Check your Spam or Blocked messages for a text from ODCARI, or tap Resend.' }
  }
  return { kind: 'waiting', title: p.autoReading ? 'Reading your SMS automatically' : 'Waiting for your code' }
}
