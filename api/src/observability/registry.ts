import { Registry, collectDefaultMetrics } from 'prom-client'

// The one Prometheus registry. It lives apart from metrics.ts (which imports the database pools and the queues) so a small module can
// declare a counter without pulling those in.
export const register = new Registry()
collectDefaultMetrics({ register })
