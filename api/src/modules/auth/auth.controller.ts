import { Request, Response, NextFunction } from 'express'
import * as authService from './auth.service'
import * as repo from './auth.repository'

export async function requestOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { phone, role, purpose = 'login' } = req.body as {
      phone: string
      role: 'user' | 'driver'
      purpose: 'login'
    }
    const result = await authService.requestOtp(phone, role, purpose)
    // Return OTP in non-production so tests and development work without SMS
    const body: Record<string, unknown> = { message: 'OTP sent' }
    if (process.env['NODE_ENV'] !== 'production' || process.env['DEMO_MODE'] === 'true') body['otp'] = result.otp
    res.status(200).json(body)
  } catch (err) {
    next(err)
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { phone, otp, role, purpose = 'login' } = req.body as {
      phone: string
      otp: string
      role: 'user' | 'driver'
      purpose: 'login'
    }
    const result = await authService.verifyOtp(phone, otp, role, purpose)
    res.status(result.isNew ? 201 : 200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function adminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string }
    const result = await authService.adminLogin(email, password, req.ip ?? null)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function adminTotpVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { pendingToken, code } = req.body as { pendingToken: string; code: string }
    const result = await authService.verifyAdminTotp(pendingToken, code, req.ip ?? null)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken: token } = req.body as { refreshToken: string }
    const result = await authService.refreshTokens(token)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken: token } = req.body as { refreshToken: string }
    await authService.logout(token)
    res.status(200).json({ message: 'Logged out successfully' })
  } catch (err) {
    next(err)
  }
}

// Returns the authenticated principal's own profile.
// Protected by authenticate() middleware — set in routes.
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user) {
      const user = await repo.findUserById(req.user.id)
      res.status(200).json({ principal: user, role: 'user' })
    } else if (req.driver) {
      const driver = await repo.findDriverById(req.driver.id)
      res.status(200).json({ principal: driver, role: 'driver' })
    } else if (req.admin) {
      const admin = await repo.findAdminById(req.admin.id)
      res.status(200).json({ principal: admin, role: 'admin' })
    } else {
      res.status(401).json({ error: 'Authentication required', code: 'AUTH_UNAUTHORIZED' })
    }
  } catch (err) {
    next(err)
  }
}
