import { Request, Response, NextFunction } from 'express'
import * as service from './vehicles.service'

export async function getCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categories = await service.getCategories()
    res.status(200).json(categories)
  } catch (err) {
    next(err)
  }
}

export async function getBrands(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const brands = await service.getBrands()
    res.status(200).json(brands)
  } catch (err) {
    next(err)
  }
}

export async function getModels(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const brandId = parseInt(req.params['brandId'] ?? '', 10)
    if (isNaN(brandId)) {
      res.status(400).json({ error: 'Invalid brand ID', code: 'VALIDATION_ERROR' })
      return
    }
    const models = await service.getModels(brandId)
    res.status(200).json(models)
  } catch (err) {
    next(err)
  }
}
