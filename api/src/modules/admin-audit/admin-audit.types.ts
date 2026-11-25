import type { AdminRole } from '@/constants/enums'

// pg returns BIGINT columns as strings; ids are typed as string here.
export interface AuditLogRow {
  id: string
  admin_id: string | null
  admin_email: string | null
  admin_role: AdminRole | null
  action: string
  target_table: string
  target_id: string | null
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  ip_address: string | null
  reason: string | null
  outcome: 'success' | 'failure' | 'denied'
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
  // When it happened (occurred_at, falling back to created_at for rows written before v2).
  occurred_at: string
  created_at: string
}

export interface AuditFilters {
  adminId?: string
  actions?: string[]       // exact names, or a prefix when the entry ends with '*'
  targetTable?: string
  targetId?: string
  outcome?: 'success' | 'failure' | 'denied'
  source?: 'service' | 'http' | 'auth' | 'system'
  from?: string            // ISO timestamp, inclusive
  to?: string              // ISO timestamp, exclusive
  q?: string
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
  unchained: number          // rows written before hash-chaining existed (cannot be verified)
  head_seq: string | null
  head_hash: string | null
  broken_at: { chain_seq: string; problem: string } | null
  verified_at: string
}
