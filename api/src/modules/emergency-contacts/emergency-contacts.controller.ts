import { Request, Response, NextFunction } from 'express'
import * as service from './emergency-contacts.service'

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ contacts: await service.listContacts(req.user!.id) })
  } catch (err) {
    next(err)
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, phone } = req.body as { name: string; phone: string }
    res.status(201).json({ contact: await service.addContact(req.user!.id, name, phone) })
  } catch (err) {
    next(err)
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.removeContact(req.user!.id, BigInt(req.params['id']!))
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
