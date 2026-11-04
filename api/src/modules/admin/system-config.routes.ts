import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { recordAuditLog } from '@/lib/audit-log'
import { listConfig, getConfigById, getConfigValue, validateConfigValue, updateConfigValue } from '@/lib/system-config'
import { validateConfigBounds, versionPairCheck } from '@/lib/system-config-bounds'
import { openDiscountedRideCount } from '@/modules/offers/offers.repository'
import { cashDiscountGuard } from '@/modules/offers/cash-discount-guard'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin'))

router.get('/', async (_req, res, next) => {
  try {
    res.json({ config: await listConfig() })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const value = req.body?.value
    if (typeof value !== 'string') {
      throw httpError(422, 'value is required', AppErrors.VALIDATION_ERROR.code)
    }

    const id = BigInt(req.params['id']!)
    const before = await getConfigById(id)
    if (!before) throw createHttpError(AppErrors.NOT_FOUND)

    const validationError = validateConfigValue(before.valueType, value) ?? validateConfigBounds(before.key, value)
    if (validationError) throw httpError(422, validationError, AppErrors.VALIDATION_ERROR.code)
    const pair = versionPairCheck(before.key)
    if (pair) {
      const pairError = pair.check(value, await getConfigValue(pair.siblingKey, '0.0.0'))
      if (pairError) throw httpError(422, pairError, AppErrors.VALIDATION_ERROR.code)
    }

    // Cash discounts change what a driver collects: refuse any save that would leave them on with old driver builds allowed.
    const cashGuard = cashDiscountGuard(before.key, value, {
      cashDiscounts: await getConfigValue('offers_cash_discounts_enabled', 'false'),
      driverAndroidMin: await getConfigValue('app_update_driver_android_min', '0.0.0'),
      updateGateEnabled: await getConfigValue('app_update_enabled', 'true'),
    })
    if (cashGuard) throw httpError(422, cashGuard, 'CASH_DISCOUNT_GUARD')

    const expected = req.body?.expectedUpdatedAt
    if (expected !== undefined && (typeof expected !== 'string' || Number.isNaN(Date.parse(expected)))) {
      throw httpError(422, 'expectedUpdatedAt must be an ISO timestamp', AppErrors.VALIDATION_ERROR.code)
    }

    const updated = await updateConfigValue(id, value, req.admin!.id, expected)
    if (updated === 'conflict') {
      throw httpError(409, 'Someone else changed this setting since you loaded the page. Refresh to see the latest value.', 'CONFIG_CHANGED')
    }
    if (!updated) throw createHttpError(AppErrors.NOT_FOUND)

    await recordAuditLog({
      adminId: req.admin!.id,
      action: 'system_config.update',
      targetTable: 'system_config',
      targetId: id,
      beforeState: { key: before.key, value: before.value },
      afterState: { key: updated.key, value: updated.value },
      ipAddress: req.ip ?? null,
    })

    // Raising the commission while rides carry an offer discount charges commission on their discounted fare when they
    // settle (commission is read at settlement). Warn, never block: the admin may well want exactly that.
    const warnings: { code: string; openDiscountedRides: number; message: string }[] = []
    if (before.key === 'commission_percent' && parseFloat(value) > parseFloat(before.value)) {
      const open = await openDiscountedRideCount().catch(() => 0)
      if (open > 0) {
        warnings.push({
          code: 'OPEN_DISCOUNTED_RIDES', openDiscountedRides: open,
          message: `${open} ride${open === 1 ? '' : 's'} with a rider offer ${open === 1 ? 'is' : 'are'} not paid yet and will settle at the new commission rate.`,
        })
      }
    }
    res.json(warnings.length > 0 ? { config: updated, warnings } : { config: updated })
  } catch (err) { next(err) }
})

export default router
