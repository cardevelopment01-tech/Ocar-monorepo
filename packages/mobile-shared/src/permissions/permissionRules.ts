/**
 * The one-place permission setup both apps show right after sign-in. This file is the pure part: what a row is, which rows still block,
 * and when the screen should come back after "Not now". The screen itself is PermissionSetup.tsx; each app supplies its own rows.
 *
 *   granted  nothing to do
 *   ask      Android will still show its own dialog
 *   blocked  Android will not show the dialog again; only the system settings can change it
 */
export type PermissionStatus = 'granted' | 'ask' | 'blocked'

export interface PermissionRowModel {
  key: string
  title: string
  /** One calm sentence on what the driver or rider gets from it. */
  reason: string
  status: PermissionStatus
  /** A required row keeps the screen coming back (daily) until it is granted; an optional row never does. */
  required: boolean
  /** Button text while the row is not granted: "Allow", or "Always allow" for the second location step. */
  actionLabel: string
}

export const SETUP_SNOOZE_MS = 24 * 60 * 60 * 1000

export function missingRequired(rows: readonly PermissionRowModel[]): PermissionRowModel[] {
  return rows.filter((r) => r.required && r.status !== 'granted')
}

/** Show the setup screen when a required permission is missing, unless the person tapped "Not now" in the last day. */
export function shouldShowSetup(rows: readonly PermissionRowModel[], snoozedAt: number | null, now: number): boolean {
  if (missingRequired(rows).length === 0) return false
  return snoozedAt === null || now - snoozedAt >= SETUP_SNOOZE_MS
}

export function statusFromNotificationPermission(p: { granted: boolean; canAskAgain: boolean; status: string }): PermissionStatus {
  if (p.granted) return 'granted'
  return p.canAskAgain && p.status !== 'denied' ? 'ask' : 'blocked'
}
