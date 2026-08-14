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

export async function uploadDocumentInit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_type, content_type } = req.body as { doc_type: string; content_type: string }
    const result = await service.initDriverDocumentUpload(req.driver!.id, doc_type, content_type)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function uploadDocumentComplete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_type, key, valid_from, valid_until } = req.body as {
      doc_type: string; key: string; valid_from?: string; valid_until?: string
    }
    const result = await service.completeDriverDocumentUpload(req.driver!.id, key, doc_type, valid_from, valid_until)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}

export async function uploadVehicleDocumentInit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_type, content_type } = req.body as { doc_type: string; content_type: string }
    const result = await service.initVehicleDocumentUpload(req.driver!.id, doc_type, content_type)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function uploadVehicleDocumentComplete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_type, key, doc_number, valid_until } = req.body as {
      doc_type: string; key: string; doc_number?: string; valid_until?: string
    }
    const result = await service.completeVehicleDocumentUpload(req.driver!.id, key, doc_type, doc_number, valid_until)
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
