import api from './api'
import type { Outcome } from './audit-log-model'

export interface AuditLogEntry {
  id: string
  admin_id: string | null
  admin_email: string | null
  admin_role: string | null
  action: string
  target_table: string
  target_id: string | null
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  ip_address: string | null
  reason: string | null
  outcome: Outcome
  source: 'service' | 'http' | 'auth' | 'system'
  request_id: string | null
  user_agent: string | null
  changed_fields: string[] | null
  summary: string | null
  http_method: string | null
  http_path: string | null
  http_status: number | null
  chain_seq: string | null
  event_hash: string | null
  occurred_at: string
  created_at: string
}

export interface AuditLogPage {
  entries: AuditLogEntry[]
  next_cursor: string | null
}

export interface AuditFacets {
  actions: { action: string; count: number }[]
  admins: { id: string; email: string | null; role: string | null; count: number }[]
  targets: string[]
  stats: { total_24h: number; failed_24h: number; denied_24h: number; admins_24h: number }
}

export interface ChainVerification {
  ok: boolean
  checked: number
  unchained: number
  head_seq: string | null
  head_hash: string | null
  broken_at: { chain_seq: string; problem: string } | null
  verified_at: string
}

const BASE = '/api/v1/admin/audit-log'

export const auditLogApi = {
  list: async (params: Record<string, string>, before?: string | null): Promise<AuditLogPage> => {
    const { data } = await api.get<AuditLogPage>(BASE, { params: { ...params, limit: '50', ...(before ? { before } : {}) } })
    return data
  },
  facets: async (): Promise<AuditFacets> => (await api.get<AuditFacets>(`${BASE}/facets`)).data,
  verify: async (): Promise<ChainVerification> => (await api.get<ChainVerification>(`${BASE}/verify`)).data,
  // Downloads through axios so the admin's auth header is sent; a plain link would not carry it.
  exportCsv: async (params: Record<string, string>): Promise<{ blob: Blob; truncated: boolean }> => {
    const res = await api.get<Blob>(`${BASE}/export.csv`, { params, responseType: 'blob' })
    return { blob: res.data, truncated: res.headers['x-export-truncated'] === '1' }
  },
}
