import type { Express } from 'express'
import request from 'supertest'

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
