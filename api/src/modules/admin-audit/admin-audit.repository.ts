import { pool } from '@/db/client'
import type { AuditFacets, AuditFilters, AuditLogRow, ChainVerification } from './admin-audit.types'

const WHEN = 'COALESCE(l.occurred_at, l.created_at)'

const COLUMNS = `
  l.id, l.admin_id,
  COALESCE(l.actor_email, a.email) AS admin_email,
  COALESCE(l.actor_role, a.role::text)   AS admin_role,
  l.action, l.target_table, l.target_id,
  l.before_state, l.after_state, l.ip_address, l.reason,
  l.outcome, l.source, l.request_id, l.user_agent, l.changed_fields, l.summary,
  l.http_method, l.http_path, l.http_status, l.chain_seq, l.event_hash,
  ${WHEN} AS occurred_at, l.created_at`

const FROM = 'FROM admin_audit_log l LEFT JOIN admins a ON a.id = l.admin_id'

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`)
}

export function buildWhere(f: AuditFilters, startAt = 1): { conds: string[]; params: unknown[] } {
  const conds: string[] = []
  const params: unknown[] = []
  const add = (v: unknown): string => { params.push(v); return `$${startAt + params.length - 1}` }

  if (f.adminId) conds.push(`l.admin_id = ${add(f.adminId)}::bigint`)
  if (f.actions && f.actions.length > 0) {
    const ors = f.actions.map(a => a.endsWith('*')
      ? `l.action LIKE ${add(`${likeEscape(a.slice(0, -1))}%`)}`
      : `l.action = ${add(a)}`)
    conds.push(`(${ors.join(' OR ')})`)
  }
  if (f.targetTable) conds.push(`l.target_table = ${add(f.targetTable)}`)
  if (f.targetId) conds.push(`l.target_id = ${add(f.targetId)}::bigint`)
  if (f.outcome) conds.push(`l.outcome = ${add(f.outcome)}`)
  if (f.source) conds.push(`l.source = ${add(f.source)}`)
  if (f.from) conds.push(`${WHEN} >= ${add(f.from)}::timestamptz`)
  if (f.to) conds.push(`${WHEN} < ${add(f.to)}::timestamptz`)
  if (f.q) {
    if (/^\d{1,18}$/.test(f.q)) {
      const n = add(f.q)
      conds.push(`(l.target_id = ${n}::bigint OR l.id = ${n}::bigint)`)
    } else {
      const exact = add(f.q)
      const like = add(`%${likeEscape(f.q)}%`)
      conds.push(`(l.request_id = ${exact} OR l.ip_address = ${exact} OR l.action ILIKE ${like} OR l.actor_email ILIKE ${like}
        OR l.summary ILIKE ${like} OR l.reason ILIKE ${like})`)
    }
  }
  return { conds, params }
}

// Newest first, keyset-paged on id (ids grow with time), so page 500 costs the same as page 1.
export async function listAuditLog(params: {
  filters: AuditFilters
  limit: number
  beforeId?: string
}): Promise<{ rows: AuditLogRow[]; hasMore: boolean }> {
  const { conds, params: values } = buildWhere(params.filters)
  if (params.beforeId) { values.push(params.beforeId); conds.push(`l.id < $${values.length}::bigint`) }
  values.push(params.limit + 1)
  const res = await pool.query<AuditLogRow>(
    `SELECT ${COLUMNS} ${FROM}
     ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''}
     ORDER BY l.id DESC LIMIT $${values.length}`,
    values,
  )
  const hasMore = res.rows.length > params.limit
  return { rows: hasMore ? res.rows.slice(0, params.limit) : res.rows, hasMore }
}

export async function exportAuditLog(filters: AuditFilters, max: number): Promise<AuditLogRow[]> {
  const { conds, params } = buildWhere(filters)
  params.push(max)
  const res = await pool.query<AuditLogRow>(
    `SELECT ${COLUMNS} ${FROM} ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''}
     ORDER BY l.id DESC LIMIT $${params.length}`,
    params,
  )
  return res.rows
}

export async function getFacets(): Promise<AuditFacets> {
  const [actions, admins, targets, stats] = await Promise.all([
    pool.query<{ action: string; count: string }>(
      `SELECT action, count(*) AS count FROM admin_audit_log
        WHERE created_at > now() - interval '180 days' GROUP BY action ORDER BY count(*) DESC LIMIT 300`),
    pool.query<{ id: string; email: string | null; role: string | null; count: string }>(
      `SELECT l.admin_id AS id, COALESCE(max(l.actor_email), max(a.email)) AS email,
              COALESCE(max(l.actor_role), max(a.role::text)) AS role, count(*) AS count
         FROM admin_audit_log l LEFT JOIN admins a ON a.id = l.admin_id
        WHERE l.admin_id IS NOT NULL AND l.created_at > now() - interval '180 days'
        GROUP BY l.admin_id ORDER BY count(*) DESC LIMIT 200`),
    pool.query<{ target_table: string }>(
      `SELECT DISTINCT target_table FROM admin_audit_log WHERE created_at > now() - interval '180 days' ORDER BY 1`),
    pool.query<{ total: string; failed: string; denied: string; admins: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE outcome = 'failure') AS failed,
              count(*) FILTER (WHERE outcome = 'denied') AS denied,
              count(DISTINCT admin_id) AS admins
         FROM admin_audit_log WHERE created_at > now() - interval '24 hours'`),
  ])
  const s = stats.rows[0]!
  return {
    actions: actions.rows.map(r => ({ action: r.action, count: Number(r.count) })),
    admins: admins.rows.map(r => ({ id: r.id, email: r.email, role: r.role, count: Number(r.count) })),
    targets: targets.rows.map(r => r.target_table),
    stats: { total_24h: Number(s.total), failed_24h: Number(s.failed), denied_24h: Number(s.denied), admins_24h: Number(s.admins) },
  }
}

// Recomputes every row's hash with the same SQL function the insert trigger uses and checks each link. Returns the
// first break, if any. A full scan: fine at admin-action volume, and run nightly, not per request.
export async function verifyChain(): Promise<ChainVerification> {
  const [broken, head, counts] = await Promise.all([
    pool.query<{ chain_seq: string; problem: string }>(
      `SELECT chain_seq, problem FROM (
         SELECT chain_seq,
           CASE
             WHEN audit_event_hash(l) <> event_hash THEN 'row content does not match its hash'
             WHEN lag(chain_seq) OVER w IS NULL AND chain_seq <> 1 THEN 'rows before this one are missing'
             WHEN lag(chain_seq) OVER w IS NULL AND prev_hash <> repeat('0', 64) THEN 'chain does not start at the genesis hash'
             WHEN lag(chain_seq) OVER w IS NOT NULL AND chain_seq <> lag(chain_seq) OVER w + 1 THEN 'a row is missing before this one'
             WHEN lag(chain_seq) OVER w IS NOT NULL AND prev_hash <> lag(event_hash) OVER w THEN 'link to the previous row is broken'
           END AS problem
         FROM admin_audit_log l WHERE chain_seq IS NOT NULL
         WINDOW w AS (ORDER BY chain_seq)
       ) t WHERE problem IS NOT NULL ORDER BY chain_seq LIMIT 1`),
    pool.query<{ chain_seq: string; event_hash: string }>(
      `SELECT chain_seq, event_hash FROM admin_audit_log WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1`),
    pool.query<{ chained: string; unchained: string }>(
      `SELECT count(*) FILTER (WHERE chain_seq IS NOT NULL) AS chained,
              count(*) FILTER (WHERE chain_seq IS NULL) AS unchained FROM admin_audit_log`),
  ])
  const b = broken.rows[0]
  return {
    ok: !b,
    checked: Number(counts.rows[0]!.chained),
    unchained: Number(counts.rows[0]!.unchained),
    head_seq: head.rows[0]?.chain_seq ?? null,
    head_hash: head.rows[0]?.event_hash ?? null,
    broken_at: b ? { chain_seq: b.chain_seq, problem: b.problem } : null,
    verified_at: new Date().toISOString(),
  }
}

// Scoped to one target (e.g. one driver) — narrower than listAuditLog so it's
// safe to expose to ops_admin, unlike the all-entities /admin/audit-log view
// which stays super_admin-only.
export async function listAuditLogForTarget(params: {
  targetTable: string
  targetId: bigint
  limit: number
  offset: number
}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const countRes = await pool.query(
    'SELECT COUNT(*) FROM admin_audit_log WHERE target_table = $1 AND target_id = $2',
    [params.targetTable, params.targetId]
  )
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query<AuditLogRow>(
    `SELECT ${COLUMNS} ${FROM}
     WHERE l.target_table = $1 AND l.target_id = $2
     ORDER BY l.id DESC
     LIMIT $3 OFFSET $4`,
    [params.targetTable, params.targetId, params.limit, params.offset]
  )

  return { rows: dataRes.rows, total }
}
