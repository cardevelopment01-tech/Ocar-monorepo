import type { DriverState, SendResult } from './kyc-reminders-api'

// Words for the onboarding follow-up report. FCM only confirms it accepted a push, so the best result is "Reached the device", never "Read".
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

export const RESULT_LABEL: Record<SendResult | 'pending', { label: string; tone: Tone }> = {
  reached: { label: 'Reached the device', tone: 'success' },
  no_device: { label: 'No device, in-app only', tone: 'warning' },
  blocked: { label: 'Notifications blocked', tone: 'danger' },
  problem: { label: 'Delivery problem', tone: 'danger' },
  pending: { label: 'Sending', tone: 'muted' },
}

export const STATE_LABEL: Record<DriverState, { label: string; tone: Tone }> = {
  not_due: { label: 'Not due yet', tone: 'muted' },
  reminded: { label: 'Reminded', tone: 'info' },
  paused: { label: 'Paused', tone: 'warning' },
  came_back: { label: 'Came back', tone: 'success' },
}

const STEP: Record<string, string> = { personal_info: 'Details', vehicle_info: 'Vehicle', documents: 'Documents', selfie: 'Selfie' }
export const stepLabel = (step: string): string => STEP[step] ?? step

/** "1 of 3 sent, last 22 Nov", or "None yet". */
export function remindersText(sends: Array<{ sentAt: string }>): string {
  if (sends.length === 0) return 'None yet'
  const last = new Date(sends[sends.length - 1]!.sentAt)
  const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(last)
  return `${sends.length} of 3 sent, last ${day}`
}
