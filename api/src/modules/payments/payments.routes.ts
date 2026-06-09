import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
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

// Razorpay webhook — no auth, signature verified inside service
router.post('/webhook/razorpay', async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string | undefined
    const webhookSecret = process.env['RAZORPAY_WEBHOOK_SECRET']

    if (webhookSecret && signature) {
      const { createHmac } = await import('crypto')
      const expected = createHmac('sha256', webhookSecret)
        .update(JSON.stringify(req.body))
        .digest('hex')
      if (signature !== expected) {
        res.status(400).json({ error: 'Invalid signature', code: 'WEBHOOK_INVALID_SIGNATURE' })
        return
      }
    }

    await service.handleWebhookEvent(req.body as Record<string, unknown>)
    res.json({ status: 'ok' })
  } catch (err) {
    next(err)
  }
})

export default router
