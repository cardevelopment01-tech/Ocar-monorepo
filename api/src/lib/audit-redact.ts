// Audit rows are immutable, so anything sensitive that lands in one can never be removed. Everything goes
// through redactAudit() before it is stored: secrets are replaced, phone numbers keep their last 4 digits,
// signed-URL query strings are cut off, and oversized values are trimmed.

const SECRET_KEY = /pass(word|code)?$|secret|token|(^|_)otp($|_)|^pin$|hash|salt|authorization|cookie|cvv|card_?(no|number)|account_?(no|number)|ifsc|aadhaa?r|^pan(_?(no|number))?$|private_?key|api_?key|signature|totp|backup_?code/i
const PHONE_KEY = /phone|mobile|msisdn/i
const URL_KEY = /(^|_)url$/i

const MAX_DEPTH = 6
const MAX_STRING = 2000
const MAX_ARRAY = 50
const MAX_BYTES = 32 * 1024

export const REDACTED = '[redacted]'

function maskPhone(v: string): string {
  const digits = v.replace(/\D/g, '')
  return digits.length <= 4 ? '****' : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
}

function walk(value: unknown, key: string, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null
  if (SECRET_KEY.test(key)) return REDACTED
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') {
    let s = value
    if (PHONE_KEY.test(key)) return maskPhone(s)
    if (URL_KEY.test(key)) s = s.split('?')[0] ?? s // signed S3 URLs carry credentials in the query string
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s
  }
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_DEPTH) return '[nested]'
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map(v => walk(v, key, depth + 1))
    if (value.length > MAX_ARRAY) out.push(`… ${value.length - MAX_ARRAY} more`)
    return out
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v, k, depth + 1)
  return out
}

/** Returns a redacted, size-capped copy, or null for null/undefined. Never mutates the input. */
export function redactAudit(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  const out = walk(value, '', 0) as Record<string, unknown>
  if (JSON.stringify(out).length > MAX_BYTES) {
    return { _truncated: true, keys: Object.keys(out).slice(0, 100) }
  }
  return out
}

/** Top-level keys whose value differs between the two states (compared as JSON), sorted. */
export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] | null {
  if (!before && !after) return null
  const b = before ?? {}
  const a = after ?? {}
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  return [...keys].filter(k => JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null)).sort()
}
