import * as repo from './admin-audit.repository'

export async function listAuditLog(query: { page?: number; limit?: number }) {
  const limit = Math.min(query.limit ?? 50, 100)
  const page = Math.max(query.page ?? 1, 1)
  const offset = (page - 1) * limit

  const { rows, total } = await repo.listAuditLog({ limit, offset })

  return {
    entries: rows,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
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
