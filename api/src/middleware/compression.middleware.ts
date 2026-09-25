import compression from 'compression'
import zlib from 'node:zlib'
import type { Request, Response } from 'express'

// The ALB doesn't compress and the ASG instances have no nginx in front, so
// this is the only layer that can. Brotli q4 is the on-the-fly sweet spot
// (q>=9 is for precompressed static files); gzip fallback covers Android
// OkHttp, which doesn't advertise br. See
// docs/superpowers/plans/2026-09-24-http-compression.md.
export const compressResponses = compression({
  threshold: 1024,
  brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
  filter: (req: Request, res: Response) => {
    // Auth bodies carry tokens next to request-reflected input (phone,
    // email) — skipping them rules out BREACH-style length oracles.
    if (req.path.startsWith('/api/v1/auth')) return false
    // Scraped over localhost by Alloy / probed by the ALB — nothing to save.
    if (req.path === '/metrics' || req.path === '/health') return false
    return compression.filter(req, res)
  },
})
