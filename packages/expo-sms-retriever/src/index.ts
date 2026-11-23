import { requireOptionalNativeModule } from 'expo'

// Google's SMS Retriever (Android only): reads the one verification SMS addressed to this app, with no SMS permission and no prompt.
// `null` on iOS, or in a build that predates this module: callers keep manual entry and the keyboard's own autofill.

interface NativeSmsRetriever {
  /** Opens a listening session (Google ends it after 5 minutes). Resolves false when it cannot: no Play services, or too old. */
  start(): Promise<boolean>
  stop(): void
  /** The 11-character hash of the key this install is signed with. For the server's ANDROID_SMS_HASH_* settings. */
  getAppHash(): string | null
  addListener(event: 'onSms', cb: (e: { message: string }) => void): { remove(): void }
  addListener(event: 'onTimeout', cb: () => void): { remove(): void }
}

export const smsRetriever = requireOptionalNativeModule<NativeSmsRetriever>('ExpoSmsRetriever')
