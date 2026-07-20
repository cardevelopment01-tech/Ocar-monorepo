declare global {
  namespace Express {
    interface Request {
      requestId: string
      rawBody?: Buffer
      user?: {
        id: bigint
        code: string
        role: 'user'
        status: string
      }
      driver?: {
        id: bigint
        code: string
        role: 'driver'
        status: string
      }
      admin?: {
        id: bigint
        code: string
        role: 'super_admin' | 'ops_admin' | 'support_admin' | 'finance_admin'
      }
    }
  }
}

export {}
