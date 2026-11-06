import { Request, Response, NextFunction } from 'express'
import * as service from './ride-shares.service'
import { TOKEN_PATTERN } from './ride-shares.validator'

const ID = /^\d{1,18}$/
const badId = (res: Response) => res.status(400).json({ error: 'Invalid id', code: 'VALIDATION_ERROR' })

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rideId = req.params['id']!
    if (!ID.test(rideId)) { badId(res); return }
    const { contactIds } = req.body as { contactIds?: string[] }
    res.status(201).json({ shares: await service.createShares(req.user!.id, BigInt(rideId), contactIds ?? []) })
  } catch (err) {
    next(err)
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rideId = req.params['id']!
    if (!ID.test(rideId)) { badId(res); return }
    res.status(200).json({ shares: await service.listShares(req.user!.id, BigInt(rideId)) })
  } catch (err) {
    next(err)
  }
}

export async function stopOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rideId = req.params['id']!
    const shareId = req.params['shareId']!
    if (!ID.test(rideId) || !ID.test(shareId)) { badId(res); return }
    await service.stopShare(req.user!.id, BigInt(rideId), BigInt(shareId))
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function stopAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rideId = req.params['id']!
    if (!ID.test(rideId)) { badId(res); return }
    await service.stopAllShares(req.user!.id, BigInt(rideId))
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

// Link-preview fetchers identify themselves; they must not count as a viewer.
const PREVIEW_BOT = /(WhatsApp|facebookexternalhit|Facebot|TelegramBot|Twitterbot|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|Googlebot|bingbot)/i
export const isPreviewBot = (userAgent: string | undefined): boolean => PREVIEW_BOT.test(userAgent ?? '')

/**
 * Public, no auth. Unknown, revoked and malformed tokens are all the same 404 (nothing to tell a scanner apart); a link that
 * existed but ran out is 410. Both mark the response as a "miss" so only wrong guesses use up the strict per-IP limit.
 */
export async function publicTrip(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    const token = req.params['token']!
    if (!TOKEN_PATTERN.test(token)) { res.locals['tripMiss'] = true; res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return }
    const result = await service.getPublicTrip(token, { countView: !isPreviewBot(req.headers['user-agent']) })
    if (result.kind === 'ok') { res.status(200).json(result.trip); return }
    res.locals['tripMiss'] = true
    if (result.kind === 'expired') { res.status(410).json({ error: 'This link is no longer active', code: 'LINK_EXPIRED' }); return }
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' })
  } catch (err) {
    next(err)
  }
}
