import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginAdmin, seedAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

const app = createApp()
const SUPER = 'drivers-export-super@ocar.app'
const SUPPORT = 'drivers-export-support@ocar.app'
const TAG = 'ZZEXP'
let superToken = ''
let supportToken = ''
let cityId = 0
let catId = 0
const driverIds: string[] = []

async function addDriver(name: string, status: string, plate: string) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO drivers (phone, full_name, status, city_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`+91960002${String(driverIds.length).padStart(4, '0')}`, name, status, cityId],
  )
  driverIds.push(rows[0]!.id)
  await pool.query(
    `INSERT INTO driver_vehicles (driver_id, category_id, number_plate, is_primary, status) VALUES ($1, $2, $3, true, 'active')`,
    [rows[0]!.id, catId, plate],
  )
}

const exportCsv = (token: string, qs = '') =>
  request(app).get(`/api/v1/admin/drivers/export.csv?search=${TAG}${qs}`).set('Authorization', `Bearer ${token}`)

beforeAll(async () => {
  await seedAdmin(pool, SUPER, 'super_admin')
  await seedAdmin(pool, SUPPORT, 'support_admin')
  superToken = (await loginAdmin(app, SUPER)).accessToken
  supportToken = (await loginAdmin(app, SUPPORT)).accessToken
  cityId = Number((await pool.query<{ id: string }>('SELECT id FROM cities ORDER BY id LIMIT 1')).rows[0]!.id)
  catId = Number((await pool.query<{ id: string }>('SELECT id FROM vehicle_categories ORDER BY id LIMIT 1')).rows[0]!.id)
  await addDriver(`${TAG} Active`, 'active', 'ZZ09E0001')
  await addDriver(`=cmd() ${TAG}`, 'pending_approval', 'ZZ09E0002') // a name that would run as a formula in Excel
  await addDriver(`${TAG} Suspended`, 'suspended', 'ZZ09E0003')
})

afterAll(async () => {
  await pool.query('DELETE FROM driver_vehicles WHERE driver_id = ANY($1)', [driverIds])
  await pool.query('DELETE FROM drivers WHERE id = ANY($1)', [driverIds])
  await cleanupAdmins(pool, [SUPER, SUPPORT])
  await pool.end()
  redis.disconnect()
})

describe('GET /api/v1/admin/drivers/export.csv', () => {
  it('returns every matching driver as CSV with the headers a spreadsheet needs', async () => {
    const res = await exportCsv(superToken)
    expect(res.status, res.text).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="ocar-drivers-\d{4}-\d{2}-\d{2}\.csv"/)
    expect(res.headers['x-export-rows']).toBe('3')
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0]).toContain('Driver code,Name,Phone')
    expect(lines).toHaveLength(4)
    expect(res.text).toContain('ZZ09E0001')
  })

  it('applies the same filters as the list (the status tab)', async () => {
    const res = await exportCsv(superToken, '&status=suspended')
    expect(res.headers['x-export-rows']).toBe('1')
    expect(res.text).toContain(`${TAG} Suspended`)
    expect(res.text).not.toContain(`${TAG} Active`)
  })

  it('defuses a formula in a text cell', async () => {
    const res = await exportCsv(superToken, '&status=pending_approval')
    const exportedName = res.text.split('\r\n')[1]!.split(',')[1]!
    expect(exportedName).toBe(`'=cmd() ${TAG}`)
  })

  it('writes an audit row with the filters and the row count', async () => {
    await exportCsv(superToken, '&status=active')
    const row = await pool.query(
      `SELECT action, after_state FROM admin_audit_log WHERE action = 'drivers.export' ORDER BY id DESC LIMIT 1`)
    expect(row.rows[0]!.action).toBe('drivers.export')
    expect(row.rows[0]!.after_state.rows).toBe(1)
    expect(row.rows[0]!.after_state.filters.status).toBe('active')
  })

  it('is closed to support admins (the list is open to them, the whole-book copy is not)', async () => {
    const res = await exportCsv(supportToken)
    expect(res.status).toBe(403)
  })

  it('needs a login', async () => {
    const res = await request(app).get('/api/v1/admin/drivers/export.csv')
    expect(res.status).toBe(401)
  })
})
