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

// null = no city given; undefined = a city_id that is not a number (the caller answers 400).
function parseCityId(raw: unknown): number | null | undefined {
  if (typeof raw !== 'string' || raw === '') return null
  return /^\d{1,9}$/.test(raw) ? parseInt(raw, 10) : undefined // whole digits only: '12abc', '1e3', '-1' are rejected, not read as 12, 1, -1
}

export async function getRentalPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categoryId = parseInt(req.params['categoryId']!, 10)
    const cityId = parseCityId(req.query['city_id'])
    if (cityId === undefined) {
      res.status(400).json({ error: 'Invalid city_id', code: 'VALIDATION_ERROR' })
      return
    }
    res.json(await service.getRentalPackages(categoryId, cityId))
  } catch (err) { next(err) }
}

export async function getAllRentalPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cityId = parseCityId(req.query['city_id'])
    if (cityId === undefined) {
      res.status(400).json({ error: 'Invalid city_id', code: 'VALIDATION_ERROR' })
      return
    }
    res.json(await service.getAllRentalPackages(cityId))
  } catch (err) { next(err) }
}
