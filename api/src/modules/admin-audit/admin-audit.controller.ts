import { Request, Response, NextFunction } from 'express'
import * as service from './admin-audit.service'

export async function getAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query: { page?: number; limit?: number } = {}
    if (req.query['page']) query.page = parseInt(req.query['page'] as string, 10)
    if (req.query['limit']) query.limit = parseInt(req.query['limit'] as string, 10)
    const result = await service.listAuditLog(query)
    res.json(result)
  } catch (err) {
    next(err)
  }
}
