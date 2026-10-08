import { pool } from '@/db/client'
import { config } from '@/config'
import { client as redis } from '@/db/redis'
import { payuConfirmCooldownKey } from '@/constants/redis-keys'
import { getConfigValue } from '@/lib/system-config'
import {
  buildPayuForm, customerFor, payuSignString, PAYU_RETURN_PATH,
  TOPUP_PRODUCT_INFO, packageProductInfo, type PayuForm,
} from '@/lib/payu'
import * as packagesRepo from '@/modules/packages/packages.repository'
import { settlePayuTxn } from '@/modules/payments/payments.service'

// Native PayU SDK support for the driver app. The SDK asks the app for hashes and
// the app asks us; this file is the only place that signs on the app's behalf, so
// it is a validating signer, never an oracle: every accepted request is either a
// string we rebuilt from an order the caller owns, or a shape that cannot collide
// with a money-path string (those start with the merchant key, these with '{').

const MAX_HASH_STRING = 2000
const SDK_TXN_ID_MAX = 25 // PayU SDK limit on transactionId

const fail = (httpStatus: number, message: string): never => {
  throw Object.assign(new Error(message), { httpStatus })
}

export async function assertMobilePaymentsEnabled(): Promise<void> {
  if ((await getConfigValue('mobile_payments_enabled', 'false')) !== 'true') {
    fail(403, 'In-app payments are not available right now')
  }
}

export interface SdkOrderParams {
  key: string
  environment: '0' | '1'
  transactionId: string
  amount: string
  productInfo: string
  firstName: string
  email: string
  phone: string
  surl: string
  furl: string
}

// The web form already carries every field the SDK needs; reuse it so web and app
// orders cannot drift. Phone must be 10 digits for the SDK ("+91" is stripped).
export function sdkParams(form: PayuForm): SdkOrderParams {
  const f = form.fields
  const transactionId = f['txnid'] ?? ''
  if (transactionId.length > SDK_TXN_ID_MAX) fail(500, 'Order id too long for the payment SDK')
  return {
    key: f['key'] ?? '',
    environment: config.PAYU_ENV === 'prod' ? '0' : '1',
    transactionId,
    amount: f['amount'] ?? '',
    productInfo: f['productinfo'] ?? '',
    firstName: f['firstname'] ?? '',
    email: f['email'] ?? '',
    phone: (f['phone'] ?? '').replace(/\D/g, '').slice(-10),
    surl: f['surl'] ?? '',
    furl: f['furl'] ?? '',
  }
}

export function withSdkParams<T extends { payu: PayuForm }>(order: T): T & { sdk: SdkOrderParams } {
  return { ...order, sdk: sdkParams(order.payu) }
}

interface OwnedOrder { txnId: string; amount: string; productInfo: string; status: string }

// An order this driver created. Null for unknown txns and for other drivers'
// txns alike, so the response never reveals which.
async function findOwnedOrder(driverId: bigint, txnId: string): Promise<OwnedOrder | null> {
  const prefix = txnId.charAt(0)
  if (prefix === 'W') {
    const res = await pool.query(
      `SELECT amount, status FROM wallet_topup_orders WHERE gateway_txn_id = $1 AND driver_id = $2`,
      [txnId, driverId]
    )
    const row = res.rows[0] as { amount: string; status: string } | undefined
    return row ? { txnId, amount: row.amount, productInfo: TOPUP_PRODUCT_INFO, status: row.status } : null
  }
  if (prefix === 'P') {
    const row = await packagesRepo.findPurchaseByTxnId(txnId)
    if (!row || row.driver_id !== String(driverId)) return null
    return { txnId, amount: row.amount, productInfo: packageProductInfo(row.package_tier_id), status: row.status }
  }
  return null
}

const KEY_PREFIXED = new Set(['get_sdk_configuration', 'get_checkout_details'])
const JSON_DATED = new Set(['get_all_offer_details', 'quickPayEvent', 'device_id'])
const DATED_JSON = /^(\{[\s\S]*\})\|[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT\|$/

function parseJson(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* fall through */ }
  return fail(400, 'Invalid hash request')
}

export async function signSdkHash(driverId: bigint, hashName: unknown, hashString: unknown): Promise<string> {
  if (typeof hashName !== 'string' || typeof hashString !== 'string' || hashString.length === 0 || hashString.length > MAX_HASH_STRING) {
    return fail(400, 'Invalid hash request')
  }
  const key = config.PAYU_KEY

  if (hashName === 'payment_source') {
    // The money hash. The client's text is only used to find which order it is for;
    // what gets signed is rebuilt from our own stored order.
    const parts = hashString.split('|')
    if (parts[0] !== key || !parts[1]) return fail(400, 'Invalid hash request')
    const order = await findOwnedOrder(driverId, parts[1])
    if (!order || order.status !== 'pending') return fail(404, 'Order not found')
    const driverRes = await pool.query(`SELECT full_name AS name, email, phone FROM drivers WHERE id = $1`, [driverId])
    const form = buildPayuForm({
      txnId: order.txnId, amount: Number(order.amount), productInfo: order.productInfo,
      customer: customerFor(driverRes.rows[0] ?? {}, 'driver', driverId),
      returnUrl: `${config.API_BASE_URL}${PAYU_RETURN_PATH}`,
    })
    return form.fields['hash'] ?? fail(500, 'Could not sign')
  }

  if (KEY_PREFIXED.has(hashName)) {
    if (hashName === 'get_sdk_configuration') {
      if (hashString !== `${key}|get_sdk_configuration|GET|`) return fail(400, 'Invalid hash request')
      return payuSignString(hashString)
    }
    const prefix = `${key}|get_checkout_details|`
    if (!hashString.startsWith(prefix) || !hashString.endsWith('|')) return fail(400, 'Invalid hash request')
    const body = parseJson(hashString.slice(prefix.length, -1))
    const details = body['transactionDetails'] as { txnId?: unknown; amount?: unknown } | undefined
    if (typeof details?.txnId !== 'string') return fail(400, 'Invalid hash request')
    const order = await findOwnedOrder(driverId, details.txnId)
    if (!order || Number(details.amount) !== Number(order.amount)) return fail(404, 'Order not found')
    return payuSignString(hashString)
  }

  if (JSON_DATED.has(hashName)) {
    // `{json}|<date>|` can never equal a key-prefixed payment/refund/verify string.
    const m = DATED_JSON.exec(hashString)
    if (!m) return fail(400, 'Invalid hash request')
    parseJson(m[1] ?? '')
    return payuSignString(hashString)
  }

  return fail(400, 'Unsupported hash')
}

export type SdkConfirmResult = 'success' | 'failed' | 'pending'

// The app's SDK callback is only a hint. This runs the same verify_payment-then-
// idempotent-credit funnel as the webhook, for an order the caller owns.
export async function confirmSdkPayment(driverId: bigint, txnId: unknown): Promise<{ result: SdkConfirmResult }> {
  if (typeof txnId !== 'string' || txnId.length === 0 || txnId.length > 40) return fail(400, 'Invalid order')
  if (!(await findOwnedOrder(driverId, txnId))) return fail(404, 'Order not found')
  // Each call spends a PayU verify_payment request: collapse rapid repeats.
  const first = await redis.set(payuConfirmCooldownKey(txnId), '1', 'EX', 3, 'NX')
  if (first === null) return { result: 'pending' }
  const out = await settlePayuTxn(txnId, { txnid: txnId })
  return { result: out.result }
}
