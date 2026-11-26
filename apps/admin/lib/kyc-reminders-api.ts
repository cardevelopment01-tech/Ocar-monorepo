import api from './api'

export type SendResult = 'reached' | 'no_device' | 'blocked' | 'problem'
export type DriverState = 'not_due' | 'reminded' | 'paused' | 'came_back'

export type ReminderRow = {
  driverId: string
  name: string | null
  phone: string
  step: string
  lastProgressAt: string
  state: DriverState
  sends: Array<{ n: number; sentAt: string; result: SendResult | 'pending' }>
  lastResult: SendResult | null
}
export type ReminderReport = {
  summary: { stalled: number; reminded: number; cameBack: number; notReached: number }
  rows: ReminderRow[]
}

export const kycRemindersApi = {
  report: (params: { state?: DriverState; result?: SendResult }) =>
    api.get<ReminderReport>('/admin/driver-onboarding/reminders', { params }).then((r) => r.data),
}
