import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...args: ClassValue[]) => twMerge(clsx(args))

/** Converts a Date to a datetime-local input string using the device's local timezone. */
export function toDatetimeLocal(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`
}

/**
 * Computes round-trip duration in whole hours from a return datetime.
 * Returns undefined when returnAt is null (no date selected yet).
 * Minimum 4h, ceiling to whole hours — mirrors backend clampTripHours.
 */
export function clampTripHours(returnAt: Date | null): number | undefined {
  if (returnAt === null) return undefined
  const rawHours = (returnAt.getTime() - Date.now()) / 3_600_000
  return Math.max(4, Math.ceil(rawHours))
}

/**
 * Formats a stored return_at ISO string for display: "5 Jul · 18:00"
 * Uses local hours/minutes and a hardcoded month list — avoids toLocaleTimeString
 * which is unreliable across browsers with en-IN + hour12:false.
 */
export function formatReturnAt(iso: string): string {
  const d = new Date(iso)
  const z = (n: number) => String(n).padStart(2, '0')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${months[d.getMonth()]} · ${z(d.getHours())}:${z(d.getMinutes())}`
}

/** Returns the earliest valid return datetime (now + 4h) as a datetime-local string. */
export function minReturnDatetimeLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + 240, 0, 0)
  return toDatetimeLocal(d)
}
