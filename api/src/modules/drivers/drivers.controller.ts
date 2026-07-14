import { Request, Response, NextFunction } from 'express'
import * as service from './drivers.service'

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getMe(req.driver!.id)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { full_name: string; email?: string }
    const updated = await service.updateProfile(req.driver!.id, body)
    res.status(200).json({ driver: updated })
  } catch (err) {
    next(err)
  }
}

export async function getPersonalInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await service.getPersonalInfo(req.driver!.id)
    res.status(200).json(data)
  } catch (err) {
    next(err)
  }
}

export async function savePersonalInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.savePersonalInfo(req.driver!.id, req.body as Parameters<typeof service.savePersonalInfo>[1])
    res.status(200).json({ success: true, ...result })
  } catch (err) {
    next(err)
  }
}

export async function getVehicleInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getVehicleInfo(req.driver!.id)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function saveVehicleInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.saveVehicleInfo(req.driver!.id, req.body as Parameters<typeof service.saveVehicleInfo>[1])
    res.status(200).json({ success: true, ...result })
  } catch (err) {
    next(err)
  }
}

export async function saveIdentityDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { license_number, aadhaar_number } = req.body as { license_number: string; aadhaar_number: string }
    await service.saveIdentityDocuments(req.driver!.id, license_number, aadhaar_number)
    res.status(200).json({ success: true })
  } catch (err) {
    next(err)
  }
}

export async function uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(422).json({ error: 'No file uploaded', code: 'VALIDATION_ERROR' })
      return
    }
    const { doc_type, valid_from, valid_until } = req.body as { doc_type: string; valid_from?: string; valid_until?: string }
    const result = await service.uploadDriverDocument(req.driver!.id, req.file, doc_type, valid_from, valid_until)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}

export async function uploadVehicleDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(422).json({ error: 'No file uploaded', code: 'VALIDATION_ERROR' })
      return
    }
    const { doc_type, doc_number, valid_until } = req.body as {
      doc_type: string; doc_number?: string; valid_until?: string
    }
    const result = await service.uploadVehicleDocument(req.driver!.id, req.file, doc_type, doc_number, valid_until)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}

export async function getDocumentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getDocumentStatus(req.driver!.id)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function submitApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.submitApplication(req.driver!.id)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}
