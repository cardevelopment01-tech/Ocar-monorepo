import { Request, Response, NextFunction } from 'express'
import * as service from './pricing.service'

export async function estimateFare(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // pricing_version is server-internal (scheduled-ride re-quotes); a public caller must not pick the formula.
    const { pricing_version: _ignored, ...body } = req.body as Record<string, unknown>
    res.json(await service.getFareEstimate(body as unknown as Parameters<typeof service.getFareEstimate>[0]))
  } catch (err) { next(err) }
}

export async function getRateCards(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getAllRateCards())
  } catch (err) { next(err) }
}

export async function getRentalPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categoryId = parseInt(req.params['categoryId']!, 10)
    const cityIdRaw = req.query['city_id']
    let cityId: number | null = null
    if (typeof cityIdRaw === 'string' && cityIdRaw !== '') {
      cityId = parseInt(cityIdRaw, 10)
      if (isNaN(cityId)) {
        res.status(400).json({ error: 'Invalid city_id', code: 'VALIDATION_ERROR' })
        return
      }
    }
    res.json(await service.getRentalPackages(categoryId, cityId))
  } catch (err) { next(err) }
}
