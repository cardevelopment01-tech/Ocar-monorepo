import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'

// GET /pricing/rental-packages (all categories, one call) must return exactly what the per-category route returns, category by category.

const app = createApp()

afterAll(async () => {
  await pool.end()
  redis.disconnect()
})

describe('GET /api/v1/pricing/rental-packages', () => {
  it('returns every category\'s packages, identical to the per-category route', async () => {
    const all = await request(app).get('/api/v1/pricing/rental-packages')
    expect(all.status).toBe(200)
    const rows = all.body as Array<{ id: number; category_id: number }>
    const categoryIds = [...new Set(rows.map((r) => r.category_id))]
    expect(categoryIds.length).toBeGreaterThan(1)
    for (const categoryId of categoryIds) {
      const one = await request(app).get(`/api/v1/pricing/rental-packages/${categoryId}`)
      expect(one.status).toBe(200)
      expect(rows.filter((r) => r.category_id === categoryId).map((r) => r.id)).toEqual((one.body as Array<{ id: number }>).map((r) => r.id))
    }
  })

  it('matches the per-category route when a city is given', async () => {
    const city = (await pool.query(`SELECT id FROM cities WHERE status = 'active' ORDER BY id LIMIT 1`)).rows[0] as { id: number } | undefined
    if (!city) return
    const all = await request(app).get(`/api/v1/pricing/rental-packages?city_id=${city.id}`)
    expect(all.status).toBe(200)
    const rows = all.body as Array<{ id: number; category_id: number }>
    for (const categoryId of new Set(rows.map((r) => r.category_id))) {
      const one = await request(app).get(`/api/v1/pricing/rental-packages/${categoryId}?city_id=${city.id}`)
      expect(rows.filter((r) => r.category_id === categoryId).map((r) => r.id)).toEqual((one.body as Array<{ id: number }>).map((r) => r.id))
    }
  })

  it('never returns an inactive package', async () => {
    const all = await request(app).get('/api/v1/pricing/rental-packages')
    expect((all.body as Array<{ is_active: boolean }>).every((r) => r.is_active)).toBe(true)
  })

  it('rejects a city_id that is not whole digits, on both routes', async () => {
    for (const bad of ['abc', '12abc', '1e3', '-1']) {
      for (const path of ['/api/v1/pricing/rental-packages', '/api/v1/pricing/rental-packages/1']) {
        const res = await request(app).get(`${path}?city_id=${bad}`)
        expect(res.status, `${path}?city_id=${bad}`).toBe(400)
        expect(res.body.code).toBe('VALIDATION_ERROR')
      }
    }
  })
})
