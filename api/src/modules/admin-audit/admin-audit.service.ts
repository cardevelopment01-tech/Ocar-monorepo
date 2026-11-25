import * as repo from './admin-audit.repository'
import { toCsv } from '@/modules/analytics/csv'
import type { AuditFilters } from './admin-audit.types'

export const EXPORT_MAX_ROWS = 20_000

export async function listAuditLog(query: { filters: AuditFilters; limit?: number; before?: string }) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100)
  const params: { filters: AuditFilters; limit: number; beforeId?: string } = { filters: query.filters, limit }
  if (query.before) params.beforeId = query.before
  const { rows, hasMore } = await repo.listAuditLog(params)
  return {
    entries: rows,
    next_cursor: hasMore ? rows[rows.length - 1]!.id : null,
  }
}

export async function listAuditLogForTarget(
  targetTable: string,
  targetId: bigint,
  query: { page?: number; limit?: number }
) {
  const limit = Math.min(query.limit ?? 20, 100)
  const page = Math.max(query.page ?? 1, 1)
  const offset = (page - 1) * limit

  const { rows, total } = await repo.listAuditLogForTarget({ targetTable, targetId, limit, offset })

  return {
    entries: rows,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  }
}

export const getFacets = repo.getFacets
export const verifyChain = repo.verifyChain

export async function exportCsv(filters: AuditFilters): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const rows = await repo.exportAuditLog(filters, EXPORT_MAX_ROWS + 1)
  const truncated = rows.length > EXPORT_MAX_ROWS
  const kept = truncated ? rows.slice(0, EXPORT_MAX_ROWS) : rows
  const csv = toCsv(
    ['ID', 'Time (UTC)', 'Admin', 'Role', 'Action', 'Outcome', 'Target', 'Target ID', 'Summary', 'Changed fields', 'Reason', 'IP', 'Request ID', 'Source', 'HTTP', 'Chain #'],
    kept.map(r => [
      r.id, new Date(r.occurred_at).toISOString(), r.admin_email ?? (r.admin_id ? `admin #${r.admin_id}` : 'system'), r.admin_role ?? '',
      r.action, r.outcome, r.target_table, r.target_id ?? '', r.summary ?? '', (r.changed_fields ?? []).join(' '), r.reason ?? '',
      r.ip_address ?? '', r.request_id ?? '', r.source, r.http_method ? `${r.http_method} ${r.http_path ?? ''} ${r.http_status ?? ''}`.trim() : '', r.chain_seq ?? '',
    ]),
  )
  return { csv, rows: kept.length, truncated }
}
