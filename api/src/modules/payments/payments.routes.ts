import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { config } from '@/config'
import { client as redis } from '@/db/redis'
import { walletTopupOrderKey } from '@/constants/redis-keys'
import { verifyHmacSignature } from '@/lib/hash'
import * as service from './payments.service'
import * as packagesService from '@/modules/packages/packages.service'
import * as packagesRepo from '@/modules/packages/packages.repository'

const router: IRouter = Router()

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
    if (!amount || amount < 100) { res.status(400).json({ error: 'Minimum top-up is ₹100' }); return }

    // Dev mode: no Razorpay keys — credit wallet directly so testing works
    if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
      await service.topUpDriverWallet(driverId, amount, `dev_${Date.now()}`)
      res.json({ dev: true, credited: amount })
      return
    }

    const Razorpay = (await import('razorpay')).default
    const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
    const order = await (rzp.orders.create as Function)({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: `wallet_${driverId}_${Date.now()}`,
    })
    const orderId = (order as { id: string }).id
    // Bind this order to the driver who created it so /verify can reject a
    // paymentId/signature obtained for one driver being replayed by another.
    await redis.set(walletTopupOrderKey(orderId), driverId.toString(), 'EX', 1800)
    res.json({ orderId, amount, currency: 'INR', key: config.RAZORPAY_KEY_ID })
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

export default router
