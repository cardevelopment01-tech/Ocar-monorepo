import type { RequestHandler } from 'express'
import { httpRequestDuration } from '@/observability/metrics'

// Request-duration metric. The label is the MOUNTED route pattern ('/api/v1/drivers/me'), never the raw URL, so the series
// count stays bounded the same way the Loki labels do.
//
// req.route.path alone is only the innermost router's local fragment (this app nests routers under /api/v1/<module>/...),
// so '/:id' from rides and '/:id' from drivers would collapse into one label: prepend req.baseUrl.
//
// But Express restores req.baseUrl when an error leaves a nested router, so by the time the response finishes (the error
// middleware answers at app level) baseUrl is '' again and a FAILED request used to be labelled '/me' instead of
// '/api/v1/drivers/me': exactly the requests worth finding. So the full label is captured at the moment the route is
// matched, while baseUrl is still the mounted prefix. (Express sets req.route when the route matches; the setter below
// observes that assignment without changing the value.)
export const httpMetricsMiddleware: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint()
  let route: typeof req.route = undefined
  let label = 'unmatched'
  Object.defineProperty(req, 'route', {
    configurable: true,
    enumerable: true,
    get: () => route,
    set: (value: typeof req.route) => {
      route = value
      label = value ? `${req.baseUrl}${value.path}` : 'unmatched'
    },
  })
  res.on('finish', () => {
    httpRequestDuration.observe(
      { method: req.method, route: label, status_code: String(res.statusCode) },
      Number(process.hrtime.bigint() - start) / 1e9,
    )
  })
  next()
}
