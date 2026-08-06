import { Request, Response, NextFunction } from 'express'
import * as service from './ride-chat.service'
import type { ChatCaller } from './ride-chat.types'

function caller(req: Request): ChatCaller {
  const c: ChatCaller = {}
  if (req.user?.id !== undefined) c.userId = req.user.id
  if (req.driver?.id !== undefined) c.driverId = req.driver.id
  return c
}

// ── POST /rides/:id/messages ────────────────────────────────────────
export async function postMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rideId = BigInt(req.params['id']!)
    const body = req.body as { body?: unknown; clientMsgId?: unknown }
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      res.status(400).json({ error: 'body is required', code: 'VALIDATION_ERROR' }); return
    }
    if (typeof body.clientMsgId !== 'string' || body.clientMsgId === '') {
      res.status(400).json({ error: 'clientMsgId is required', code: 'VALIDATION_ERROR' }); return
    }
    const msg = await service.sendMessage(rideId, caller(req), {
      body: body.body.trim(),
      clientMsgId: body.clientMsgId,
    })
    res.status(201).json(msg)
  } catch (err) { next(err) }
}

// ── GET /rides/:id/messages ─────────────────────────────────────────
export async function getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rideId = BigInt(req.params['id']!)
    const afterRaw = req.query['after']
    const after = typeof afterRaw === 'string' && afterRaw !== '' ? BigInt(afterRaw) : undefined
    const messages = await service.getHistory(rideId, caller(req), after)
    res.json({ messages })
  } catch (err) { next(err) }
}

// ── PATCH /rides/:id/messages/read ──────────────────────────────────
export async function markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rideId = BigInt(req.params['id']!)
    const result = await service.markRead(rideId, caller(req))
    res.json(result)
  } catch (err) { next(err) }
}
