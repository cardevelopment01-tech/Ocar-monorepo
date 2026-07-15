import { Request, Response, NextFunction } from 'express'
import * as ratingsService from './ratings.service'
import * as sosService     from './sos.service'
import * as disputeService from './disputes.service'
import type { RatingDirection } from './safety.types'

// ── GET /safety/tags ──────────────────────────────────────────────
export async function getTags(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const direction = (req.query['direction'] as RatingDirection | undefined) ?? 'user_to_driver'
    const tags = await ratingsService.getRatingTags(direction)
    res.json(tags)
  } catch (err) { next(err) }
}

// ── POST /safety/ratings ──────────────────────────────────────────
export async function postRating(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      rideId: string | number
      direction: RatingDirection
      score: number
      comment?: string
      tagIds?: (string | number)[]
    }

    const rideId    = BigInt(body.rideId)
    const direction = body.direction
    const score     = Number(body.score)

    if (!direction || !['user_to_driver', 'driver_to_user'].includes(direction)) {
      res.status(400).json({ error: 'Invalid direction', code: 'VALIDATION_ERROR' })
      return
    }
    if (!score || score < 1 || score > 5) {
      res.status(400).json({ error: 'Score must be between 1 and 5', code: 'VALIDATION_ERROR' })
      return
    }

    const input: Parameters<typeof ratingsService.submitRating>[0] = { rideId, direction, score }
    if (req.user?.id   !== undefined) input.fromUserId   = req.user.id
    if (req.driver?.id !== undefined) input.fromDriverId = req.driver.id
    if (body.comment    !== undefined) input.comment     = body.comment
    if (body.tagIds     !== undefined) input.tagIds      = body.tagIds.map(t => BigInt(t))

    const rating = await ratingsService.submitRating(input)
    res.status(201).json(rating)
  } catch (err) { next(err) }
}

// ── POST /safety/sos ──────────────────────────────────────────────
export async function postSos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      rideId: string | number
      severity?: 'low' | 'medium' | 'high'
      lat?: number
      lng?: number
      notes?: string
    }

    if (!body.rideId) {
      res.status(400).json({ error: 'rideId is required', code: 'VALIDATION_ERROR' })
      return
    }

    const input: Parameters<typeof sosService.triggerSos>[0] = { rideId: BigInt(body.rideId) }
    if (req.user?.id   !== undefined) input.triggeredByUserId   = req.user.id
    if (req.driver?.id !== undefined) input.triggeredByDriverId = req.driver.id
    if (body.severity  !== undefined) input.severity            = body.severity
    if (body.lat       !== undefined) input.lat                 = body.lat
    if (body.lng       !== undefined) input.lng                 = body.lng
    if (body.notes     !== undefined) input.notes               = body.notes

    const alert = await sosService.triggerSos(input)
    res.status(201).json(alert)
  } catch (err) { next(err) }
}

// ── POST /safety/disputes ─────────────────────────────────────────
export async function postDispute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      rideId: string | number
      type: string
      description: string
      priority?: number
    }

    if (!body.rideId || !body.type || !body.description) {
      res.status(400).json({ error: 'rideId, type, and description are required', code: 'VALIDATION_ERROR' })
      return
    }

    const initiator = req.user ? 'user' as const : 'driver' as const

    const input: Parameters<typeof disputeService.createDispute>[0] = {
      rideId:      BigInt(body.rideId),
      type:        body.type,
      description: body.description,
      initiator,
    }
    if (body.priority         !== undefined) input.priority           = body.priority
    if (req.user?.id          !== undefined) input.initiatedByUserId   = req.user.id
    if (req.driver?.id        !== undefined) input.initiatedByDriverId = req.driver.id

    const dispute = await disputeService.createDispute(input)
    res.status(201).json(dispute)
  } catch (err) { next(err) }
}
