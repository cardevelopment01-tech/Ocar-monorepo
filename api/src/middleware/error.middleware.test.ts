import { describe, it, expect, vi } from 'vitest'

vi.mock('@/config', () => ({ config: { NODE_ENV: 'production' } }))

import { errorMiddleware } from './error.middleware'

function run(err: unknown) {
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) }
  errorMiddleware(err, { requestId: 'r1' } as any, res, vi.fn() as any)
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] }
}

describe('errorMiddleware', () => {
  it('answers 400 INVALID_ID when an id param is not numeric', () => {
    let err: unknown
    try { BigInt('abc') } catch (e) { err = e }
    const { status, body } = run(err)
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Invalid id', code: 'INVALID_ID', requestId: 'r1' })
  })

  it('still answers 500 with a fixed message for other SyntaxErrors', () => {
    const { status, body } = run(new SyntaxError('Unexpected token'))
    expect(status).toBe(500)
    expect(body.error).toBe('Internal server error')
  })
})
