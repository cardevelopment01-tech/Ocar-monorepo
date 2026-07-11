import { Bell, Car, CircleCheck, TriangleAlert, FileText, type LucideIcon } from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  ride_accepted: Car,
  ride_completed: CircleCheck,
  sos: TriangleAlert,
  driver_submitted_for_review: FileText,
}

const TINTS: Record<string, { bg: string; text: string }> = {
  ride_accepted: { bg: 'bg-primary/10', text: 'text-primary' },
  ride_completed: { bg: 'bg-money-light', text: 'text-money' },
  sos: { bg: 'bg-status-error/10', text: 'text-status-error' },
  driver_submitted_for_review: { bg: 'bg-status-info/10', text: 'text-status-info' },
}

export function getNotificationIcon(type: string): LucideIcon {
  return ICONS[type] ?? Bell
}

export function getNotificationTint(type: string, unread: boolean): { bg: string; text: string } {
  if (!unread) return { bg: 'bg-surface-2', text: 'text-text-muted' }
  return TINTS[type] ?? { bg: 'bg-primary/10', text: 'text-primary' }
}
