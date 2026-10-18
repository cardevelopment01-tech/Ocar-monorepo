import { logger } from '@/lib/logger'

// Watches this instance's Auto Scaling target lifecycle state through IMDSv2 and calls `onTerminating` once when
// it becomes "Terminated" (the instance is being scaled in). The deploy workflow drains the old color itself
// before scaling it down; this covers the other terminations the workflow cannot see (autoscaler scale-in).
//
// AWS documents the value as the state the instance is moving to and says to poll often, but does not say whether
// it changes before or after the load balancer starts draining the target. So the moment it is seen is logged with
// its timestamp: compare it with the Auto Scaling activity time to learn the real order.
// https://docs.aws.amazon.com/autoscaling/ec2/userguide/retrieving-target-lifecycle-state-through-imds.html
//
// The API runs in a container; the launch template sets the IMDS hop limit to 2 so it can reach IMDS.

const IMDS = 'http://169.254.169.254'
const STATE_PATH = '/latest/meta-data/autoscaling/target-lifecycle-state'

export interface WatcherOptions {
  intervalMs?: number
  fetchFn?: typeof fetch
}

export function startTerminationWatcher(onTerminating: () => void, opts: WatcherOptions = {}): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 5000
  const doFetch = opts.fetchFn ?? fetch
  let token: { value: string; expiresAt: number } | null = null
  let lastState = ''
  let lastErrorLogAt = 0
  let fired = false

  async function getToken(): Promise<string> {
    if (token && token.expiresAt > Date.now()) return token.value
    const res = await doFetch(`${IMDS}/latest/api/token`, {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '300' },
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) throw new Error(`IMDS token request returned ${res.status}`)
    token = { value: (await res.text()).trim(), expiresAt: Date.now() + 240_000 }
    return token.value
  }

  async function poll(): Promise<void> {
    if (fired) return
    try {
      const res = await doFetch(`${IMDS}${STATE_PATH}`, {
        headers: { 'X-aws-ec2-metadata-token': await getToken() },
        signal: AbortSignal.timeout(1500),
      })
      if (res.status === 404) return // an instance that never changed state has no value yet
      if (res.status === 401) token = null // expired token: fetch a new one next time
      if (!res.ok) throw new Error(`IMDS returned ${res.status}`)
      const state = (await res.text()).trim()
      if (state !== lastState) {
        logger.info({ state, previous: lastState || null }, 'instance target lifecycle state')
        lastState = state
      }
      if (state === 'Terminated') {
        fired = true
        clearInterval(timer)
        onTerminating()
      }
    } catch (err) {
      // Not on EC2, or IMDS briefly unavailable: stay quiet, but say so now and then.
      if (Date.now() - lastErrorLogAt > 10 * 60_000) {
        lastErrorLogAt = Date.now()
        logger.warn({ err }, 'termination watcher: could not read the instance lifecycle state')
      }
    }
  }

  const timer = setInterval(() => void poll(), intervalMs)
  timer.unref()
  void poll()
  return { stop: () => clearInterval(timer) }
}
