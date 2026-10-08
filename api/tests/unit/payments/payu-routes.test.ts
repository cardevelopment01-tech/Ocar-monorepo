import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/config', () => ({
  config: { USER_APP_URL: 'https://app.example', DRIVER_APP_URL: 'https://driver.example', PAYU_KEY: 'k', PAYU_SALT: 's', NODE_ENV: 'test' },
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/middleware/auth.middleware', () => ({ authenticate: () => (_q: unknown, _r: unknown, n: () => void) => n() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@/modules/packages/packages.service', () => ({}))
vi.mock('@/modules/packages/packages.repository', () => ({}))
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }))
vi.mock('@/modules/payments/payments.service', () => ({ handlePayuNotification: handle }))

import router from '@/modules/payments/payments.routes'
import { errorMiddleware } from '@/middleware/error.middleware'

const app = express()
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use('/api/v1/payments', router)
app.use(errorMiddleware)

const RETURN = '/api/v1/payments/payu/return'
const HOOK = '/api/v1/payments/webhook/payu'

describe('POST /payu/return', () => {
  beforeEach(() => { handle.mockReset() })

  it.each([
    [{ kind: 'ride', id: '101', result: 'success' }, 'https://app.example/ride/101/receipt?pay=success'],
    [{ kind: 'ride', id: '101', result: 'failed' }, 'https://app.example/ride/101/receipt?pay=failed'],
    [{ kind: 'wallet', id: '7', result: 'success' }, 'https://driver.example/wallet?pay=success'],
    [{ kind: 'package', id: '7', result: 'pending' }, 'https://driver.example/recharge-package?pay=pending'],
    [{ kind: 'unknown', id: null, result: 'pending' }, 'https://app.example/'],
    [{ kind: 'ride', id: '101', result: 'pending', error: true }, 'https://app.example/ride/101/receipt?pay=pending'],
    [{ kind: 'wallet', id: '7', result: 'pending', error: true }, 'https://driver.example/wallet?pay=pending'],
  ])('redirects %j', async (outcome, location) => {
    handle.mockResolvedValue(outcome)
    const res = await request(app).post(RETURN).type('form').send({ txnid: 'x', hash: 'h' })
    expect(res.status).toBe(303)
    expect(res.headers['location']).toBe(location)
  })

  it('bad hash redirects to the portal home, never a success URL', async () => {
    handle.mockImplementation(async () => { throw Object.assign(new Error('Invalid signature'), { httpStatus: 400 }) })
    const res = await request(app).post(RETURN).type('form').send({ txnid: 'x', hash: 'bad' })
    expect(res.status).toBe(303)
    expect(res.headers['location']).toBe('https://app.example/')
  })

  it('unexpected non-400 throw also redirects home', async () => {
    handle.mockImplementation(async () => { throw new Error('boom') })
    const res = await request(app).post(RETURN).type('form').send({ txnid: 'x', hash: 'h' })
    expect(res.status).toBe(303)
    expect(res.headers['location']).toBe('https://app.example/')
  })
})

describe('POST /webhook/payu', () => {
  beforeEach(() => { handle.mockReset() })

  it('acks hash-less JSON refund/dispute events with 200 without confirming anything', async () => {
    const res = await request(app).post(HOOK).send({ event: 'refund', payuId: '1' })
    expect(res.status).toBe(200)
    expect(handle).not.toHaveBeenCalled()
  })

  it('400 on a bad hash', async () => {
    handle.mockImplementation(async () => { throw Object.assign(new Error('Invalid signature'), { httpStatus: 400, appCode: 'WEBHOOK_INVALID_SIGNATURE' }) })
    const res = await request(app).post(HOOK).type('form').send({ txnid: 'x', hash: 'bad' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('WEBHOOK_INVALID_SIGNATURE')
  })

  it('200 on a verified payment notification', async () => {
    handle.mockResolvedValue({ kind: 'ride', id: '1', result: 'success' })
    const res = await request(app).post(HOOK).type('form').send({ txnid: 'x', hash: 'ok' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('500 PAYMENT_CONFIRM_RETRY when the funnel flags an infrastructure error', async () => {
    handle.mockResolvedValue({ kind: 'ride', id: '1', result: 'pending', error: true })
    const res = await request(app).post(HOOK).type('form').send({ txnid: 'x', hash: 'ok' })
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Temporary failure', code: 'PAYMENT_CONFIRM_RETRY' })
  })
})
