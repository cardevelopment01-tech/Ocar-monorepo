import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { config } from '@/config'
import { client as redis } from '@/db/redis'
import { walletTopupOrderKey } from '@/constants/redis-keys'
import { payuConfigured } from '@/lib/payu'
import { verifyHmacSignature } from '@/lib/hash'
import * as service from './payments.service'
import type { PayuOutcome } from './payments.service'
import { logger } from '@/lib/logger'
import * as packagesService from '@/modules/packages/packages.service'
import * as packagesRepo from '@/modules/packages/packages.repository'

const router: IRouter = Router()
const log = logger.child({ module: 'payments-routes' })

// Driver: get own wallet
router.get('/wallet/driver', authenticate(), async (req, res, next) => {
  try {
    const wallet = await service.getDriverWallet(req.driver!.id)
    res.json(wallet ?? { balance: '0.00', recent_ledger: [] })
  } catch (err) {
    next(err)
  }
})

// User: get own wallet
router.get('/wallet/user', authenticate(), async (req, res, next) => {
  try {
    const wallet = await service.getUserWallet(req.user!.id)
    res.json(wallet ?? { balance: '0.00', recent_ledger: [] })
  } catch (err) {
    next(err)
  }
})

// Driver wallet top-up — create order (or direct credit in dev)
router.post('/wallet/driver/topup/order', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const { amount } = req.body as { amount: number }

    // Dev mode: no PayU keys — credit wallet directly so testing works
    if (!payuConfigured()) {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 100) {
        res.status(400).json({ error: 'Minimum top-up is ₹100' }); return
      }
      await service.topUpDriverWallet(driverId, amount, `dev_${Date.now()}`)
      res.json({ dev: true, credited: amount })
      return
    }

    res.json(await service.createDriverTopupOrder(driverId, amount))
  } catch (err) { next(err) }
})

// Driver wallet top-up — verify Razorpay payment + credit
router.post('/wallet/driver/topup/verify', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const { orderId, paymentId, signature } = req.body as {
      orderId: string; paymentId: string; signature: string
    }

    // Dev mode only: no Razorpay keys configured, nothing to verify against.
    if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
      res.status(400).json({ error: 'Payment verification is not configured' })
      return
    }

    // This order must have been created by this same driver — stops a
    // paymentId/signature tuple for one driver's order being replayed
    // against a different driver's account.
    const boundDriverId = await redis.get(walletTopupOrderKey(orderId))
    if (boundDriverId !== driverId.toString()) {
      res.status(400).json({ error: 'Order does not belong to this driver' }); return
    }

    if (!verifyHmacSignature(config.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`, signature)) {
      res.status(400).json({ error: 'Invalid payment signature' }); return
    }

    // Never trust the client-supplied amount — fetch the captured amount
    // straight from Razorpay so a replayed/forged amount can't inflate the credit.
    const Razorpay = (await import('razorpay')).default
    const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
    const payment = await (rzp.payments.fetch as Function)(paymentId) as {
      order_id: string; status: string; amount: number
    }
    if (payment.order_id !== orderId || payment.status !== 'captured') {
      res.status(400).json({ error: 'Payment not verified' }); return
    }

    const amount = payment.amount / 100
    await service.topUpDriverWallet(driverId, amount, paymentId)
    await redis.del(walletTopupOrderKey(orderId))
    res.json({ success: true })
  } catch (err) { next(err) }
})

// Driver: list active package tiers
router.get('/packages/tiers', authenticate(), async (_req, res, next) => {
  try {
    res.json(await packagesRepo.listActiveTiers())
  } catch (err) { next(err) }
})

// Driver: get own package wallet
router.get('/packages/wallet', authenticate(), async (req, res, next) => {
  try {
    const wallet = await packagesRepo.getPackageWallet(req.driver!.id)
    res.json(wallet ?? { balance: '0.00', is_frozen: false })
  } catch (err) { next(err) }
})

// Driver: create a package purchase order (or direct credit in dev)
router.post('/packages/purchase/order', authenticate(), async (req, res, next) => {
  try {
    const result = await packagesService.createPackagePurchaseOrder(
      req.driver!.id,
      BigInt(req.body.tierId)
    )
    res.json(result)
  } catch (err) { next(err) }
})

// Razorpay webhook — no auth, signature verified inside service
router.post('/webhook/razorpay', async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string | undefined
    const webhookSecret = process.env['RAZORPAY_WEBHOOK_SECRET']

    if (!webhookSecret) {
      res.status(500).json({ error: 'Webhook not configured', code: 'WEBHOOK_NOT_CONFIGURED' })
      return
    }

    if (!signature) {
      res.status(400).json({ error: 'Missing signature', code: 'WEBHOOK_INVALID_SIGNATURE' })
      return
    }

    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body))
    if (!verifyHmacSignature(webhookSecret, rawBody, signature)) {
      res.status(400).json({ error: 'Invalid signature', code: 'WEBHOOK_INVALID_SIGNATURE' })
      return
    }

    await service.handleWebhookEvent(req.body as Record<string, unknown>)
    res.json({ status: 'ok' })
  } catch (err) {
    next(err)
  }
})

// PayU redirects the browser here (surl/furl/curl are all this URL) as a
// form POST. Public: authenticity comes from the response hash, then from
// verify_payment inside the funnel — not from a session.
function payuRedirectUrl(out: PayuOutcome): string {
  const q = `?pay=${out.result}`
  if (out.kind === 'ride' && out.id) return `${config.USER_APP_URL}/ride/${out.id}/receipt${q}`
  if (out.kind === 'wallet') return `${config.DRIVER_APP_URL}/wallet${q}`
  if (out.kind === 'package') return `${config.DRIVER_APP_URL}/recharge-package${q}`
  return `${config.USER_APP_URL}/`
}

// Failed return (bad hash / unexpected throw): nothing posted is trusted, so the
// destination comes from a fixed map keyed on the txnid's first character only —
// no pay= flag and no posted value ever reaches the URL.
function payuFallbackUrl(txnid: unknown): string {
  const prefix = typeof txnid === 'string' ? txnid.charAt(0) : ''
  if (prefix === 'W') return `${config.DRIVER_APP_URL}/wallet`
  if (prefix === 'P') return `${config.DRIVER_APP_URL}/recharge-package`
  return `${config.USER_APP_URL}/`
}

router.post('/payu/return', async (req, res) => {
  try {
    const out = await service.handlePayuNotification(req.body as Record<string, string>)
    // out.error (infrastructure failure) deliberately does not change the
    // redirect: the user lands on the right page with pay=pending.
    res.redirect(303, payuRedirectUrl(out))
  } catch (err) {
    // The funnel throws only for a bad hash (httpStatus 400); anything else is
    // unexpected. Either way never redirect to a success page.
    if ((err as { httpStatus?: number }).httpStatus === 400) log.warn({ err }, 'PayU return rejected: bad hash')
    else log.error({ err }, 'PayU return failed unexpectedly')
    res.redirect(303, payuFallbackUrl((req.body as Record<string, unknown> | undefined)?.['txnid']))
  }
})

// Webhook (configure in PayU dashboard -> Developers -> Webhooks). Payment
// success/failure arrive form-encoded WITH a hash; refund/dispute arrive as JSON
// with no documented hash — acknowledge and log only, never act on them.
router.post('/webhook/payu', async (req, res, next) => {
  try {
    const body = req.body as Record<string, string>
    if (!body['hash']) {
      log.info({ keys: Object.keys(body) }, 'PayU webhook without hash (refund/dispute) acknowledged')
      res.json({ status: 'ok' })
      return
    }
    const out = await service.handlePayuNotification(body)
    if (out.error) {
      // Non-2xx so PayU may retry (its retry schedule is undocumented).
      res.status(500).json({ error: 'Temporary failure', code: 'PAYMENT_CONFIRM_RETRY' })
      return
    }
    res.json({ status: 'ok' })
  } catch (err) {
    next(err)
  }
})

export default router
