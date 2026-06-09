import { Request, Response, NextFunction } from 'express'
import * as service from './pricing.service'

export async function estimateFare(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getFareEstimate(req.body))
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
    res.json(await service.getRentalPackages(categoryId))
  } catch (err) { next(err) }
}
