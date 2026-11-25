import { gzipSync } from 'node:zlib'
import { pool } from '@/db/client'
import { config } from '@/config'
import { logger } from '@/lib/logger'
import { putPrivateObject } from '@/lib/storage'
import { verifyChain } from '@/modules/admin-audit/admin-audit.repository'
import { auditChainBrokenGauge } from '@/observability/metrics'

const log = logger.child({ job: 'audit-maintenance' })

// Nightly: recompute the whole hash chain. A break means a row was changed, removed or inserted behind the
// application's back, so every super admin is paged and the audit_chain_broken gauge goes to 1 (alert on it).
export async function verifyAuditChainJob(): Promise<void> {
  const r = await verifyChain()
  auditChainBrokenGauge.set(r.ok ? 0 : 1)
  if (r.ok) { log.info({ checked: r.checked, unchained: r.unchained }, 'audit chain verified'); return }
  log.error({ brokenAt: r.broken_at }, 'AUDIT CHAIN BROKEN')
  const { notifyAllAdmins } = await import('@/modules/notifications/notifications.service')
  await notifyAllAdmins({
    type: 'audit_chain_broken',
    title: 'Audit log integrity check failed',
    body: `Entry #${r.broken_at?.chain_seq}: ${r.broken_at?.problem}. Open the audit log and investigate.`,
    payload: { ...r.broken_at },
    roles: ['super_admin'],
  })
}

// Copies one UTC day (default: yesterday) of audit rows to S3 as gzipped NDJSON. The table is append-only in the database,
// but a copy outside it is what lets a wiped table be noticed and rebuilt. Same key every time, so re-running is safe.
export async function archiveAuditDayJob(day?: string): Promise<{ key: string; rows: number } | null> {
  if (config.NODE_ENV !== 'production') return null
  const d = day ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)
  const lines: string[] = []
  let after = '0'
  for (;;) {
    const res = await pool.query<{ id: string }>(
      `SELECT l.* FROM admin_audit_log l
        WHERE l.created_at >= $1::date AND l.created_at < $1::date + 1 AND l.id > $2::bigint
        ORDER BY l.id LIMIT 5000`,
      [d, after],
    )
    if (res.rows.length === 0) break
    for (const r of res.rows) lines.push(JSON.stringify(r))
    after = res.rows[res.rows.length - 1]!.id
  }
  if (lines.length === 0) return null
  const key = `audit-archive/${d.slice(0, 4)}/${d.slice(5, 7)}/${d}.ndjson.gz`
  await putPrivateObject(key, gzipSync(lines.join('\n') + '\n'), 'application/gzip')
  log.info({ key, rows: lines.length }, 'audit day archived')
  return { key, rows: lines.length }
}
