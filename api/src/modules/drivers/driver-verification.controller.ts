import { Request, Response, NextFunction } from 'express'
import * as service from './driver-verification.service'

export async function getVerificationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getStatus(req.driver!.id))
  } catch (err) { next(err) }
}

export async function submitVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const files = req.files as { selfie?: Express.Multer.File[]; plate?: Express.Multer.File[] } | undefined
    const selfie = files?.selfie?.[0]
    const plate  = files?.plate?.[0]
    if (!selfie || !plate) {
      res.status(422).json({ error: 'Both selfie and plate photos are required', code: 'VALIDATION_ERROR' })
      return
    }
    const result = await service.submit(req.driver!.id, { selfie, plate })
    res.status(201).json(result)
  } catch (err) { next(err) }
}
