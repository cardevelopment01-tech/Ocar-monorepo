import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { config } from '@/config'
import * as service from './payments.service'

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
    res.json({ orderId: (order as { id: string }).id, amount, currency: 'INR', key: config.RAZORPAY_KEY_ID })
  } catch (err) { next(err) }
})

// Driver wallet top-up — verify Razorpay payment + credit
router.post('/wallet/driver/topup/verify', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const { orderId, paymentId, signature, amount } = req.body as {
      orderId: string; paymentId: string; signature: string; amount: number
    }
    if (config.RAZORPAY_KEY_SECRET) {
      const { createHmac } = await import('crypto')
      const expected = createHmac('sha256', config.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`).digest('hex')
      if (signature !== expected) { res.status(400).json({ error: 'Invalid payment signature' }); return }
    }
    await service.topUpDriverWallet(driverId, amount, paymentId)
    res.json({ success: true })
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

    const { createHmac } = await import('crypto')
    const expected = createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex')
    if (signature !== expected) {
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
