import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireDriver } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as bankAccounts from './bank-accounts.service'
import * as service from './settlements.service'

const router: IRouter = Router()
router.use(authenticate(), requireDriver())

router.get('/bank-accounts', async (req, res, next) => {
  try {
    const accounts = await bankAccounts.listBankAccounts(req.driver!.id)
    res.json({ accounts })
  } catch (err) { next(err) }
})

router.post('/bank-accounts', async (req, res, next) => {
  try {
    const { accountHolderName, accountNumber, ifsc, upiVpa } = req.body as Record<string, unknown>
    if (typeof accountHolderName !== 'string' || accountHolderName.trim().length === 0) {
      throw httpError(422, 'accountHolderName is required', AppErrors.VALIDATION_ERROR.code)
    }
    if (typeof accountNumber !== 'string' || accountNumber.trim().length < 6) {
      throw httpError(422, 'accountNumber is required', AppErrors.VALIDATION_ERROR.code)
    }
    if (typeof ifsc !== 'string' || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      throw httpError(422, 'ifsc is invalid', AppErrors.VALIDATION_ERROR.code)
    }
    const id = await bankAccounts.addBankAccount(req.driver!.id, {
      accountHolderName, accountNumber, ifsc,
      ...(typeof upiVpa === 'string' ? { upiVpa } : {}),
    })
    res.status(201).json({ id: id.toString() })
  } catch (err) { next(err) }
})

router.get('/earnings', async (req, res, next) => {
  try {
    const summary = await service.getDriverEarningsSummary(req.driver!.id)
    res.json(summary)
  } catch (err) { next(err) }
})

router.post('/payout/instant', async (req, res, next) => {
  try {
    const settlementId = await service.instantCashOut(req.driver!.id)
    res.status(201).json({ settlementId: settlementId.toString() })
  } catch (err) { next(err) }
})

export default router
