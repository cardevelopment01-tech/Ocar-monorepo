import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginAdmin, seedAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

// Every non-driver admin CSV export against the real app: shape, filters, role gates and the audit row.

const app = createApp()
const EMAILS = {
  super: 'exports-super@ocar.app', ops: 'exports-ops@ocar.app', fin: 'exports-fin@ocar.app', support: 'exports-support@ocar.app',
}
const tok: Record<string, string> = {}
let userId = '', driverId = '', rideId = '', catId = ''
let userPhone = '+919800007701'

const get = (who: string, path: string) => request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${tok[who]}`)
const body = (res: request.Response) => res.text.replace(/^﻿/, '').trim().split('\r\n')

beforeAll(async () => {
  await seedAdmin(pool, EMAILS.super, 'super_admin')
  await seedAdmin(pool, EMAILS.ops, 'ops_admin')
  await seedAdmin(pool, EMAILS.fin, 'finance_admin')
  await seedAdmin(pool, EMAILS.support, 'support_admin')
  for (const [k, e] of Object.entries(EMAILS)) tok[k] = (await loginAdmin(app, e)).accessToken
  catId = (await pool.query<{ id: string }>('SELECT id FROM vehicle_categories ORDER BY id LIMIT 1')).rows[0]!.id
  userId = (await pool.query<{ id: string }>(
    `INSERT INTO users (phone, name) VALUES ($1, 'ZZXP Rider') ON CONFLICT (phone) DO UPDATE SET name = 'ZZXP Rider' RETURNING id`, [userPhone])).rows[0]!.id
  driverId = (await pool.query<{ id: string }>(
    `INSERT INTO drivers (phone, full_name, status) VALUES ('+919800007702', 'ZZXP Driver', 'active') RETURNING id`)).rows[0]!.id
  await pool.query(`INSERT INTO driver_vehicles (driver_id, category_id, number_plate, is_primary, status) VALUES ($1, $2, 'ZZ09X7702', true, 'active')`, [driverId, catId])
  rideId = (await pool.query<{ id: string }>(
    `INSERT INTO rides (user_id, driver_id, category_id, status, ride_type, origin, destination, origin_address, destination_address, requested_at)
     VALUES ($1, $2, $3, 'completed', 'one_way', ST_SetSRID(ST_MakePoint(85.8, 20.3), 4326)::geography, ST_SetSRID(ST_MakePoint(85.9, 20.4), 4326)::geography,
             'ZZXP pickup', 'ZZXP drop', now()) RETURNING id`, [userId, driverId, catId])).rows[0]!.id
  await pool.query(`INSERT INTO sos_alerts (ride_id, triggered_by_user, severity, status, notes) VALUES ($1, $2, 'high', 'triggered', 'ZZXP sos')`, [rideId, userId])
  await pool.query(
    `INSERT INTO disputes (ride_id, initiator, initiated_by_user, type, description, sla_due_at) VALUES ($1, 'user', $2, 'other', 'ZZXP dispute', now() + interval '2 days')`, [rideId, userId])
})

afterAll(async () => {
  await pool.query('DELETE FROM disputes WHERE ride_id = $1', [rideId])
  await pool.query('DELETE FROM sos_alerts WHERE ride_id = $1', [rideId])
  await pool.query('DELETE FROM rides WHERE id = $1', [rideId])
  await pool.query('DELETE FROM driver_vehicles WHERE driver_id = $1', [driverId])
  await pool.query('DELETE FROM drivers WHERE id = $1', [driverId])
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  await cleanupAdmins(pool, Object.values(EMAILS))
  await pool.end()
  redis.disconnect()
})

describe('admin CSV exports', () => {
  it('users: filtered by search, with the wallet and ride count columns', async () => {
    const res = await get('ops', '/users/export.csv?search=ZZXP')
    expect(res.status, res.text).toBe(200)
    expect(res.headers['content-disposition']).toContain('ocar-users-')
    expect(body(res)[0]).toContain('User code,Name,Phone')
    expect(body(res)).toHaveLength(2)
    expect(res.text).toContain('ZZXP Rider')
  })

  it('rides: needs a date range, then returns the rides in it', async () => {
    const bad = await get('ops', '/rides/export.csv?search=ZZXP')
    expect(bad.status).toBe(400)
    const day = new Date().toISOString().slice(0, 10)
    const res = await get('ops', `/rides/export.csv?search=ZZXP&dateFrom=${day}&dateTo=${day}`)
    expect(res.status, res.text).toBe(200)
    expect(res.headers['x-export-rows']).toBe('1')
    expect(res.text).toContain('ZZXP pickup')
    expect(res.text).toContain('ZZXP Driver')
  })

  it('fleet: lists the vehicle with its driver', async () => {
    const res = await get('ops', '/vehicles/fleet/export.csv?status=active')
    expect(res.status, res.text).toBe(200)
    expect(res.text).toContain('ZZ09X7702')
  })

  it('pending vehicle documents: returns the header even when the queue is empty, and never a file link', async () => {
    const res = await get('ops', '/vehicles/documents/pending/export.csv')
    expect(res.status, res.text).toBe(200)
    expect(body(res)[0]).toBe('Driver code,Driver,Plate,Vehicle,Document,Document number,Uploaded (UTC)')
    expect(res.text).not.toMatch(/file_url|https?:\/\//)
  })

  it('sos: exports the alert with its ride and people; an unknown status is refused', async () => {
    const res = await get('ops', '/safety/sos/export.csv?status=triggered')
    expect(res.status, res.text).toBe(200)
    expect(res.text).toContain('ZZXP sos')
    expect((await get('ops', '/safety/sos/export.csv?status=bogus')).status).toBe(400)
  })

  it('disputes: exports the dispute; an unknown status is refused', async () => {
    const res = await get('ops', '/safety/disputes/export.csv?status=open')
    expect(res.status, res.text).toBe(200)
    expect(res.text).toContain('ZZXP dispute')
    expect((await get('ops', '/safety/disputes/export.csv?status=bogus')).status).toBe(400)
  })

  it('payments: finance and super only (ops is refused), and the file has the money columns', async () => {
    expect((await get('ops', '/payments/export.csv')).status).toBe(403)
    const res = await get('fin', '/payments/export.csv?search=ZZXP')
    expect(res.status, res.text).toBe(200)
    expect(body(res)[0]).toContain('Payment ID,Ride ID,Status,Channel,Amount (INR)')
  })

  it('payout batches: finance only; the batch list and a batch detail both come back as CSV', async () => {
    expect((await request(app).get('/api/v1/admin/payouts/export.csv').set('Authorization', `Bearer ${tok.ops}`)).status).toBe(403)
    const list = await request(app).get('/api/v1/admin/payouts/export.csv').set('Authorization', `Bearer ${tok.fin}`)
    expect(list.status, list.text).toBe(200)
    expect(body(list)[0]).toBe('Period from,Period to,Run type,Status,Drivers,Total (INR)')
    const one = await request(app).get('/api/v1/admin/payouts/export.csv?periodFrom=2026-01-01&periodTo=2026-01-07').set('Authorization', `Bearer ${tok.fin}`)
    expect(one.status, one.text).toBe(200)
    expect(body(one)[0]).toContain('Settlement ID,Driver ID,Driver')
  })

  it('support admins cannot export any of the personal-data lists', async () => {
    for (const p of ['/users/export.csv', '/rides/export.csv?dateFrom=2026-01-01&dateTo=2026-01-02', '/vehicles/fleet/export.csv', '/safety/sos/export.csv', '/safety/disputes/export.csv']) {
      expect((await get('support', p)).status, p).toBe(403)
    }
  })

  it('every export is audited with its entity and row count', async () => {
    const r = await pool.query(`SELECT action, after_state FROM admin_audit_log WHERE action LIKE '%.export' AND action <> 'audit_log.export' ORDER BY id`)
    const actions = new Set(r.rows.map(x => x.action as string))
    for (const a of ['users.export', 'rides.export', 'fleet.export', 'sos.export', 'disputes.export', 'payments.export', 'payout-batches.export', 'payout-batch.export']) {
      expect(actions.has(a), a).toBe(true)
    }
    const rides = r.rows.find(x => x.action === 'rides.export')!
    expect(rides.after_state.rows).toBe(1)
  })
})
