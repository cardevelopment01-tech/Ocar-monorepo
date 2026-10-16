import { describe, it, expect } from 'vitest'
import { isDbUnavailable } from './db-errors'

describe('isDbUnavailable', () => {
  it('flags connection-class and failover errors', () => {
    expect(isDbUnavailable(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isDbUnavailable(Object.assign(new Error('x'), { code: '57P01' }))).toBe(true)
    expect(isDbUnavailable(Object.assign(new Error('x'), { code: '08006' }))).toBe(true)
    expect(isDbUnavailable(Object.assign(new Error('x'), { code: '25006' }))).toBe(true)
    expect(isDbUnavailable(new Error('Connection terminated unexpectedly'))).toBe(true)
    expect(isDbUnavailable(new Error('timeout exceeded when trying to connect'))).toBe(true)
    expect(isDbUnavailable(Object.assign(new Error('agg'), { errors: [Object.assign(new Error('x'), { code: 'ECONNREFUSED' })] }))).toBe(true)
  })
  it('leaves ordinary errors alone', () => {
    expect(isDbUnavailable(Object.assign(new Error('dup'), { code: '23505' }))).toBe(false)
    expect(isDbUnavailable(Object.assign(new Error('bad sql'), { code: '42703' }))).toBe(false)
    expect(isDbUnavailable(new Error('jwt expired'))).toBe(false)
    expect(isDbUnavailable(null)).toBe(false)
    expect(isDbUnavailable('boom')).toBe(false)
  })
})
