export type StatusKind = 'success' | 'error' | 'info' | 'warning'

// Exact status->kind mapping from web's history/page.tsx STATUS_KIND. Pulled
// out of StatusBadge.tsx so the mapping rule is independently testable.
const STATUS_KIND: Record<string, StatusKind> = {
  completed: 'success',
  cancelled: 'error',
  no_drivers: 'error',
  scheduled: 'info',
  requested: 'warning',
  accepted: 'warning',
  driver_arrived: 'warning',
  in_progress: 'warning',
}

export function statusKind(status: string): StatusKind {
  return STATUS_KIND[status] ?? 'warning'
}
