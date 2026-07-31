import type { AdminRole } from '@/constants/enums'

// pg returns BIGINT columns as strings; ids are typed as string here.
export interface AuditLogRow {
  id: string
  admin_id: string | null
  admin_email: string | null
  admin_role: AdminRole | null
  action: string
  target_table: string
  target_id: string
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  ip_address: string | null
  reason: string | null
  created_at: string
}
