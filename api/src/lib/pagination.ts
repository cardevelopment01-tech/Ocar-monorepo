export function encodeCursor(id: bigint, createdAt: Date): string {
  const payload = JSON.stringify({ id: id.toString(), createdAt: createdAt.toISOString() })
  return Buffer.from(payload).toString('base64')
}

export function decodeCursor(cursor: string): { id: bigint; createdAt: Date } | null {
  try {
    const payload = Buffer.from(cursor, 'base64').toString('utf-8')
    const parsed = JSON.parse(payload) as { id: string; createdAt: string }
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') {
      return null
    }
    return {
      id: BigInt(parsed.id),
      createdAt: new Date(parsed.createdAt),
    }
  } catch {
    return null
  }
}

export function buildCursorWhere(
  cursor: string | undefined,
  tableAlias?: string
): string {
  if (!cursor) return ''
  const prefix = tableAlias ? `${tableAlias}.` : ''
  return `AND (${prefix}created_at, ${prefix}id) < ($cursor_created_at, $cursor_id)`
}

export interface PaginationResult<T> {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
}
