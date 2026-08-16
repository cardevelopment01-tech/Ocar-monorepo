import { Request, Response, NextFunction } from 'express'
import * as service from './saved-places.service'
import type { SavedPlaceKind } from './saved-places.repository'

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const places = await service.listPlaces(req.user!.id)
    res.status(200).json({ places })
  } catch (err) {
    next(err)
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { kind: SavedPlaceKind; label?: string; address: string; latitude: number; longitude: number }
    const place = await service.createPlace(req.user!.id, body)
    res.status(201).json({ place })
  } catch (err) {
    next(err)
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { label?: string; address: string; latitude: number; longitude: number }
    const place = await service.updatePlace(req.user!.id, BigInt(req.params['id']!), body)
    res.status(200).json({ place })
  } catch (err) {
    next(err)
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.removePlace(req.user!.id, BigInt(req.params['id']!))
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
