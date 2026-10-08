import crypto from 'crypto'
import { config } from '@/config'

export interface PayuCustomer { name: string; email: string; phone: string }
export interface PayuForm { action: string; fields: Record<string, string> }

const sha512 = (parts: string[]): string =>
  crypto.createHash('sha512').update(parts.join('|')).digest('hex')

// udf1..udf5 and the unused udf6..udf10 slots are always present (empty) —
// PayU's formula requires the pipes even when the fields are blank.
const UDF = ['', '', '', '', '']
const UNUSED = ['', '', '', '', '']

export const PAYU_RETURN_PATH = '/api/v1/payments/payu/return'

export function payuConfigured(): boolean {
  return Boolean(config.PAYU_KEY && config.PAYU_SALT)
}

export function payuUrls(): { payment: string; api: string } {
  const prod = config.PAYU_ENV === 'prod'
  return {
    payment: prod ? 'https://secure.payu.in/_payment' : 'https://test.payu.in/_payment',
    api: prod
      ? 'https://info.payu.in/merchant/postservice.php?form=2'
      : 'https://test.payu.in/merchant/postservice.php?form=2',
  }
}

// Decimal string → integer paise with no float arithmetic. Extra fractional
// digits are truncated (never rounded up) so a mismatch can only fail closed.
export function toPaise(amount: string): number {
  const [rupees = '0', frac = ''] = amount.trim().split('.')
  return Number(rupees) * 100 + Number((frac + '00').slice(0, 2))
}

// PayU txnid: alphanumeric, ≤25 chars (limit to be confirmed in the sandbox,
// Task 12). Prefix says what it pays for: R ride, W wallet top-up, P package.
export function newTxnId(prefix: 'R' | 'W' | 'P', id: bigint | string): string {
  return `${prefix}${id}x${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
}

export function sanitizeFirstname(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/[^A-Za-z ]/g, '').trim().slice(0, 60)
  return clean || 'Customer'
}

export function customerFor(
  row: { name?: string | null; email?: string | null; phone?: string | null },
  role: 'user' | 'driver',
  id: bigint | string,
): PayuCustomer {
  return {
    name: row.name ?? '',
    // PayU requires a syntactically valid email; deterministic fallback so the
    // same account always posts the same address.
    email: row.email || `${role}${id}@ocarindia.com`,
    phone: row.phone ?? '',
  }
}

export function buildPayuForm(input: {
  txnId: string
  amount: number
  productInfo: string
  customer: PayuCustomer
  returnUrl: string
}): PayuForm {
  const amount = input.amount.toFixed(2)
  const firstname = sanitizeFirstname(input.customer.name)
  const hash = sha512([
    config.PAYU_KEY, input.txnId, amount, input.productInfo, firstname, input.customer.email,
    ...UDF, ...UNUSED, config.PAYU_SALT,
  ])
  return {
    action: payuUrls().payment,
    fields: {
      key: config.PAYU_KEY,
      txnid: input.txnId,
      amount,
      productinfo: input.productInfo,
      firstname,
      email: input.customer.email,
      phone: input.customer.phone,
      surl: input.returnUrl,
      furl: input.returnUrl,
      curl: input.returnUrl,
      hash,
    },
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase())
  const y = Buffer.from(b.toLowerCase())
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// Reverse hash. The key is ours (config), never the posted one, so a forged
// callback cannot choose what gets hashed. Missing fields hash as empty.
export function verifyPayuResponseHash(body: Record<string, string | undefined>): boolean {
  const received = body['hash']
  if (typeof received !== 'string' || received.length === 0) return false
  const g = (k: string): string => body[k] ?? ''
  const extra = g('additional_charges') || g('additionalCharges')
  const parts = [
    ...(extra ? [extra] : []),
    config.PAYU_SALT, g('status'),
    ...UNUSED, ...UDF,
    g('email'), g('firstname'), g('productinfo'), g('amount'), g('txnid'), config.PAYU_KEY,
  ]
  return safeEqualHex(sha512(parts), received)
}

export function payuApiHash(command: string, var1: string): string {
  return sha512([config.PAYU_KEY, command, var1, config.PAYU_SALT])
}
