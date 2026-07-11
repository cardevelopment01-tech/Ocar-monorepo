import api from './api'
import type { AdminRole } from './mock-data'

export interface AuditLogEntry {
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
  created_at: string
}

export interface AuditLogPage {
  entries: AuditLogEntry[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const auditLogApi = {
  list: async (params: { page?: number; limit?: number }): Promise<AuditLogPage> => {
    const { data } = await api.get<AuditLogPage>('/api/v1/admin/audit-log', { params })
    return data
  },
}
