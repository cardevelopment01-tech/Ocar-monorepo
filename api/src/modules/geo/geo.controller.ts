import { Request, Response, NextFunction } from 'express'
import * as service from './geo.service'

export async function getCities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getCities())
  } catch (err) { next(err) }
}

export async function getNearestCity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const lat = parseFloat(req.query['lat'] as string)
    const lng = parseFloat(req.query['lng'] as string)
    if (isNaN(lat) || isNaN(lng)) {
      res.status(422).json({ error: 'lat and lng query params required', code: 'VALIDATION_ERROR' })
      return
    }
    res.json(await service.findNearestCity(lat, lng))
  } catch (err) { next(err) }
}

export async function flushTracks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tracks } = req.body as {
      tracks?: Array<{
        ride_id: number
        session_id: number
        latitude: number
        longitude: number
        heading?: number
        speed_kmph?: number
        accuracy_metres?: number
        recorded_at: string
      }>
    }
    if (!Array.isArray(tracks) || !tracks.length) {
      res.status(422).json({ error: 'tracks array required', code: 'VALIDATION_ERROR' })
      return
    }
    const driverId = Number(req.driver!.id)
    const capped = tracks.slice(0, 100).map(t => ({ ...t, driver_id: driverId }))
    res.json(await service.flushGpsTracks(capped))
  } catch (err) { next(err) }
}
