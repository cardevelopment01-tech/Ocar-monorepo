import { pool } from '@/db/client'
import type { NotifChannel } from './notifications.repository'

export interface VariablesSchema {
  required: string[]
  optional: string[]
}

export interface NotificationTemplate {
  id: string
  slug: string
  name: string
  channel: NotifChannel
  locale: string
  subject: string | null
  body: string
  variablesSchema: VariablesSchema
  isActive: boolean
  version: number
  createdAt: string
  updatedAt: string
}

interface TemplateRow {
  id: string
  slug: string
  name: string
  channel: NotifChannel
  locale: string
  subject: string | null
  body: string
  variables_schema: VariablesSchema
  is_active: boolean
  version: number
  created_at: Date
  updated_at: Date
}

function toTemplate(row: TemplateRow): NotificationTemplate {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    channel: row.channel,
    locale: row.locale,
    subject: row.subject,
    body: row.body,
    variablesSchema: row.variables_schema,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

const TEMPLATE_COLUMNS = `id, slug, name, channel, locale, subject, body, variables_schema, is_active, version, created_at, updated_at`

export async function getActiveTemplate(
  slug: string,
  channel: NotifChannel,
  locale = 'en'
): Promise<NotificationTemplate | null> {
  const res = await pool.query<TemplateRow>(
    `SELECT ${TEMPLATE_COLUMNS} FROM notification_templates
     WHERE slug = $1 AND channel = $2 AND locale = $3 AND is_active
     LIMIT 1`,
    [slug, channel, locale]
  )
  const row = res.rows[0]
  return row ? toTemplate(row) : null
}

export async function listTemplates(): Promise<NotificationTemplate[]> {
  const res = await pool.query<TemplateRow>(
    `SELECT ${TEMPLATE_COLUMNS} FROM notification_templates ORDER BY slug, channel, locale`
  )
  return res.rows.map(toTemplate)
}

export async function getTemplateById(id: bigint): Promise<NotificationTemplate | null> {
  const res = await pool.query<TemplateRow>(
    `SELECT ${TEMPLATE_COLUMNS} FROM notification_templates WHERE id = $1`,
    [id]
  )
  const row = res.rows[0]
  return row ? toTemplate(row) : null
}

// Editing subject/body bumps version — the diagram's audit signal for
// "this copy changed since it was last reviewed."
export async function updateTemplateContent(
  id: bigint,
  params: { subject: string | null; body: string; updatedBy: bigint }
): Promise<NotificationTemplate | null> {
  const res = await pool.query<TemplateRow>(
    `UPDATE notification_templates
     SET subject = $2, body = $3, version = version + 1, updated_by = $4
     WHERE id = $1
     RETURNING ${TEMPLATE_COLUMNS}`,
    [id, params.subject, params.body, params.updatedBy]
  )
  const row = res.rows[0]
  return row ? toTemplate(row) : null
}

export async function setTemplateActive(id: bigint, isActive: boolean, updatedBy: bigint): Promise<NotificationTemplate | null> {
  const res = await pool.query<TemplateRow>(
    `UPDATE notification_templates
     SET is_active = $2, updated_by = $3
     WHERE id = $1
     RETURNING ${TEMPLATE_COLUMNS}`,
    [id, isActive, updatedBy]
  )
  const row = res.rows[0]
  return row ? toTemplate(row) : null
}
