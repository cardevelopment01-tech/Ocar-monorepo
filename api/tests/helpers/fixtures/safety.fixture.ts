import type { Express } from 'express'
import request from 'supertest'
import type { Pool } from 'pg'
import { hashPassword } from '@/lib/hash'

/** Real admin login — mirrors m02.test.ts's proven pattern (TC-M02 admin tests). */
export async function loginAdmin(
  app: Express,
  email = 'admin@ocar.app',
  password = 'Admin@1234'
) {
  const res = await request(app)
    .post('/api/v1/auth/admin/login')
    .send({ email, password })
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Admin login failed: ${JSON.stringify(res.body)}`)
  }
  const { tokens, admin } = res.body as {
    tokens: { accessToken: string }
    admin: { id: string; role: string }
  }
  return { accessToken: tokens.accessToken, adminId: admin.id, role: admin.role }
}

/**
 * Seeds a real admin row for tests to log in against — there is no pre-seeded
 * admin in the test DB (only m02.test.ts's own beforeAll/afterAll-scoped
 * admin@ocar.app exists, and only for the duration of that file's run). Every
 * test file needing an admin principal seeds/deletes its own via this helper,
 * using a distinct email to avoid any cross-file collision.
 */
export async function seedAdmin(
  pool: Pool,
  email: string,
  role: 'super_admin' | 'ops_admin' | 'support_admin' | 'finance_admin' = 'super_admin',
  password = 'Admin@1234'
) {
  const hash = await hashPassword(password)
  await pool.query(`
    INSERT INTO admins (email, password_hash, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
  `, [email, hash, role])
}

export async function cleanupAdmins(pool: Pool, emails: string[]) {
  // admin_audit_log.admin_id FK has no ON DELETE action (NO ACTION), so any
  // recordAuditLog() call made during a test (e.g. vehicle/driver doc approval)
  // leaves a row that blocks deleting the admin. Clear those first.
  await pool.query(
    'DELETE FROM admin_audit_log WHERE admin_id = ANY(SELECT id FROM admins WHERE email = ANY($1))',
    [emails]
  )
  // Same shape recurs across every table an admin writes to: nullable FKs with
  // no ON DELETE action, so a test that edits/creates a row through the admin
  // API leaves that admin as an unremovable creator/editor. Centralized here
  // rather than reimplemented per test file — this list has grown by one each
  // time a new admin-authored table showed up in a task (M04's driver-doc
  // approval, M06's rate cards, M10's notification templates); add the next
  // one here too instead of inlining it in a test file's own cleanup.
  const adminOwnedColumns: Array<{ table: string; column: string }> = [
    { table: 'notification_templates', column: 'updated_by' },
    { table: 'notification_templates', column: 'created_by' },
    { table: 'rate_cards', column: 'created_by' },
    { table: 'rate_card_history', column: 'changed_by' },
  ]
  for (const { table, column } of adminOwnedColumns) {
    await pool.query(
      `UPDATE ${table} SET ${column} = NULL WHERE ${column} = ANY(SELECT id FROM admins WHERE email = ANY($1))`,
      [emails]
    )
  }
  await pool.query('DELETE FROM admins WHERE email = ANY($1)', [emails])
}
