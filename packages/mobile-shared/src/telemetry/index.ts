import * as Sentry from '@sentry/react-native'
import PostHog from 'posthog-react-native'
import {
  getCrashlytics,
  recordError,
  setCrashlyticsCollectionEnabled,
  setUserId,
} from '@react-native-firebase/crashlytics'
import type { ApiCallInfo } from '../api/client'
import { classifyApiCall, routeOf, scrubUrl, userKey } from './scrub'

export { routeOf, scrubUrl, userKey }

export type TelemetryConfig = {
  app: 'driver' | 'rider'
  /** Blank disables Sentry. Read `process.env.EXPO_PUBLIC_SENTRY_DSN` in the app so Expo inlines it. */
  sentryDsn?: string | undefined
  /** Blank disables PostHog. */
  posthogKey?: string | undefined
  posthogHost?: string | undefined
}

let posthog: PostHog | null = null
let live = false

// Every call is wrapped: a monitoring failure must never crash or slow the app it watches.
function safe(fn: () => void): void {
  try {
    fn()
  } catch {
    /* swallow */
  }
}

// Call once at module scope in the root layout, before the first render, so errors during
// start-up are captured. Off in dev builds and when no key is set (local, CI, old envs).
export function initTelemetry(cfg: TelemetryConfig): void {
  if (__DEV__ || live) return
  live = true

  safe(() => {
    if (cfg.sentryDsn) {
      Sentry.init({
        dsn: cfg.sentryDsn,
        environment: 'production',
        sendDefaultPii: false,
        // 10% of sessions are traced (app start, slow screens, slow requests). Errors are always kept.
        tracesSampleRate: 0.1,
        beforeBreadcrumb(crumb) {
          const url = crumb.data?.['url']
          if (typeof url === 'string') crumb.data = { ...crumb.data, url: scrubUrl(url) }
          return crumb
        },
      })
      Sentry.setTag('app', cfg.app)
    }
  })

  // Crashlytics collects as soon as the native module loads. Turn it on explicitly here so
  // dev builds (which return early above) never report.
  safe(() => {
    void setCrashlyticsCollectionEnabled(getCrashlytics(), true)
  })

  safe(() => {
    if (cfg.posthogKey) {
      posthog = new PostHog(cfg.posthogKey, {
        host: cfg.posthogHost ?? 'https://us.i.posthog.com',
        captureAppLifecycleEvents: true,
      })
      posthog.register({ app: cfg.app })
    }
  })
}

// Identify by role and numeric id only. No phone, name or email ever leaves the device.
export function identifyUser(role: 'driver' | 'rider', id: string | number | bigint): void {
  const key = userKey(role, id)
  safe(() => Sentry.setUser({ id: key }))
  safe(() => void setUserId(getCrashlytics(), key))
  safe(() => posthog?.identify(key))
}

export function resetUser(): void {
  safe(() => Sentry.setUser(null))
  safe(() => void setUserId(getCrashlytics(), ''))
  safe(() => posthog?.reset())
}

/** Product event. Props must be small and free of personal data (ids, codes, counts, booleans). */
export function track(event: string, props?: Record<string, string | number | boolean | null>): void {
  safe(() => posthog?.capture(event, props))
  safe(() => Sentry.addBreadcrumb({ category: 'event', message: event, ...(props ? { data: props } : {}) }))
}

export function trackScreen(name: string): void {
  safe(() => posthog?.screen(name))
}

/** A handled error worth seeing (the app recovered, but the user had a bad time). */
export function captureError(err: unknown, context?: Record<string, string | number | boolean>): void {
  const error = err instanceof Error ? err : new Error(String(err))
  safe(() => Sentry.captureException(error, context ? { extra: context } : undefined))
  safe(() => void recordError(getCrashlytics(), error))
}

/** Wrap the root component: React render errors become Sentry events with a component stack. */
export const wrapRoot = Sentry.wrap

/** Pass as `onRequestDone` to createApiClient. Reports failures, slow calls, and 5xx as errors. */
export function reportApiCall(i: ApiCallInfo): void {
  const route = routeOf(i.url)
  const kind = classifyApiCall(i.status, i.ms)
  if (kind === 'ok' || kind === 'ignore') return
  if (kind === 'slow') return track('api_slow', { route, method: i.method, ms: i.ms })
  track('api_error', { route, method: i.method, status: i.status ?? 0, code: i.code ?? null, ms: i.ms })
  if (kind === 'server_error') captureError(new Error(`API ${i.status} ${i.method} ${route}`))
}
