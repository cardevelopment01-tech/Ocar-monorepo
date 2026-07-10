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

export async function getAutocomplete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = (req.query['q'] as string ?? '').trim()
    if (!q || q.length < 2) { res.json([]); return }
    const lat = parseFloat(req.query['lat'] as string)
    const lng = parseFloat(req.query['lng'] as string)
    const suggestions = await service.autocomplete(
      q,
      isNaN(lat) ? undefined : lat,
      isNaN(lng) ? undefined : lng,
    )
    res.json(suggestions)
  } catch (err) { next(err) }
}

export async function getPlaceDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const placeId = req.params['placeId']!
    res.json(await service.getPlaceDetails(placeId))
  } catch (err) { next(err) }
}

export async function getReverseGeocode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const lat = parseFloat(req.query['lat'] as string)
    const lng = parseFloat(req.query['lng'] as string)
    if (isNaN(lat) || isNaN(lng)) {
      res.status(422).json({ error: 'lat and lng required', code: 'VALIDATION_ERROR' })
      return
    }
    res.json(await service.reverseGeocode(lat, lng))
  } catch (err) { next(err) }
}

export async function getRoute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oLat = parseFloat(req.query['originLat'] as string)
    const oLng = parseFloat(req.query['originLng'] as string)
    const dLat = parseFloat(req.query['destLat'] as string)
    const dLng = parseFloat(req.query['destLng'] as string)
    if ([oLat, oLng, dLat, dLng].some(isNaN)) {
      res.status(422).json({ error: 'originLat, originLng, destLat, destLng required', code: 'VALIDATION_ERROR' })
      return
    }
    const language = req.query['language'] as string | undefined
    const opts: Parameters<typeof service.getRoute>[4] = {
      withSteps: req.query['withSteps'] === 'true',
      trafficAware: req.query['trafficAware'] === 'true',
    }
    if (language) opts.language = language
    res.json(await service.getRoute(oLat, oLng, dLat, dLng, opts))
  } catch (err) { next(err) }
}

export async function getTripClassification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const originLat = parseFloat(req.query['originLat'] as string)
    const originLng = parseFloat(req.query['originLng'] as string)
    const destLat   = parseFloat(req.query['destLat'] as string)
    const destLng   = parseFloat(req.query['destLng'] as string)
    if ([originLat, originLng, destLat, destLng].some(isNaN)) {
      res.status(422).json({ error: 'originLat, originLng, destLat, destLng query params required', code: 'VALIDATION_ERROR' })
      return
    }
    res.json(await service.classifyTrip(originLat, originLng, destLat, destLng))
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
