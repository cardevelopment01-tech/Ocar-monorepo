import { pool } from '@/db/client'

export async function getConfigValue(key: string, fallback: string): Promise<string> {
  const res = await pool.query(
    `SELECT value FROM system_config WHERE key = $1 AND status = 'active'`,
    [key]
  )
  return res.rows[0]?.value ?? fallback
}

export interface SystemConfigRow {
  id: string
  key: string
  value: string
  valueType: string
  description: string | null
  isPublic: boolean
  status: string
  updatedAt: string
}

interface ConfigRow {
  id: string
  key: string
  value: string
  value_type: string
  description: string | null
  is_public: boolean
  status: string
  updated_at: Date
}

function toConfig(row: ConfigRow): SystemConfigRow {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    valueType: row.value_type,
    description: row.description,
    isPublic: row.is_public,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  }
}

const CONFIG_COLUMNS = `id, key, value, value_type, description, is_public, status, updated_at`

export async function listConfig(): Promise<SystemConfigRow[]> {
  const res = await pool.query<ConfigRow>(`SELECT ${CONFIG_COLUMNS} FROM system_config ORDER BY key`)
  return res.rows.map(toConfig)
}

export async function getConfigById(id: bigint): Promise<SystemConfigRow | null> {
  const res = await pool.query<ConfigRow>(`SELECT ${CONFIG_COLUMNS} FROM system_config WHERE id = $1`, [id])
  const row = res.rows[0]
  return row ? toConfig(row) : null
}

// Values are stored as TEXT and parsed by each live-code reader (e.g.
// getConfigValue callers), so a bad edit here can silently break a read
// path elsewhere — validate against value_type before writing.
export function validateConfigValue(valueType: string, value: string): string | null {
  switch (valueType) {
    case 'integer':
      return /^-?\d+$/.test(value) ? null : "value must be an integer"
    case 'decimal':
      return /^-?\d+(\.\d+)?$/.test(value) ? null : "value must be a decimal number"
    case 'boolean':
      return value === 'true' || value === 'false' ? null : "value must be 'true' or 'false'"
    case 'json':
      try { JSON.parse(value); return null } catch { return "value must be valid JSON" }
    default:
      return value.trim().length > 0 ? null : "value must not be empty"
  }
}

export async function updateConfigValue(id: bigint, value: string, updatedBy: bigint): Promise<SystemConfigRow | null> {
  const res = await pool.query<ConfigRow>(
    `UPDATE system_config SET value = $2, updated_by = $3
     WHERE id = $1 AND status = 'active'
     RETURNING ${CONFIG_COLUMNS}`,
    [id, value, updatedBy]
  )
  const row = res.rows[0]
  return row ? toConfig(row) : null
}
