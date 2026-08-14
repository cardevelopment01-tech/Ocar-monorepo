import { Request, Response, NextFunction } from 'express'
import * as service from './driver-verification.service'

export async function getVerificationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getStatus(req.driver!.id))
  } catch (err) { next(err) }
}

export async function initVerificationUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { kind, content_type, content_length } = req.body as { kind: 'selfie' | 'plate'; content_type: string; content_length: number }
    const result = await service.initUpload(req.driver!.id, kind, content_type, content_length)
    res.status(200).json(result)
  } catch (err) { next(err) }
}

export async function submitVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { selfie_key, plate_key } = req.body as { selfie_key: string; plate_key: string }
    const result = await service.submit(req.driver!.id, { selfieKey: selfie_key, plateKey: plate_key })
    res.status(201).json(result)
  } catch (err) { next(err) }
}
