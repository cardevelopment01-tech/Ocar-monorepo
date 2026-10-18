import { z } from 'zod'
import { getConfigValue } from '@/lib/system-config'

// Pure version-policy helpers plus the one config read. The kill switch and the version rows live in
// system_config (migration 118); '0.0.0' means "never prompt or block".

export const APP_NAMES = ['rider', 'driver'] as const
export const APP_PLATFORMS = ['android', 'ios'] as const
export type AppName = (typeof APP_NAMES)[number]
export type AppPlatform = (typeof APP_PLATFORMS)[number]
export type UpdateAction = 'none' | 'soft' | 'hard'

export const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/

// Fixed, not configurable. iOS needs the App Store id, so it stays null until iOS ships.
const STORE_URLS: Record<AppName, Record<AppPlatform, string | null>> = {
  rider:  { android: 'https://play.google.com/store/apps/details?id=com.ocar.rider',  ios: null },
  driver: { android: 'https://play.google.com/store/apps/details?id=com.ocar.driver', ios: null },
}

export function getStoreUrl(app: AppName, platform: AppPlatform): string | null {
  return STORE_URLS[app][platform]
}

function parts(v: string): [number, number, number] | null {
  if (!VERSION_RE.test(v)) return null
  const [a, b, c] = v.split('.').map(Number)
  return [a!, b!, c!]
}

/** <0, 0, >0 like a comparator; null if either side is not `major.minor.patch`. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parts(a)
  const pb = parts(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
  }
  return 0
}

export function decideAction(version: string, min: string, recommended: string): UpdateAction {
  const vsMin = compareVersions(version, min)
  if (vsMin !== null && vsMin < 0) return 'hard'
  const vsRec = compareVersions(version, recommended)
  if (vsRec !== null && vsRec < 0) return 'soft'
  return 'none'
}

export interface AppIdentity { app: AppName; platform: AppPlatform; version: string }

const identitySchema = z.object({
  app: z.enum(APP_NAMES),
  platform: z.enum(APP_PLATFORMS),
  version: z.string().regex(VERSION_RE),
})

/** Validated identity or null. Shared by the endpoint (query) and the header readers. */
export function parseIdentity(raw: { app?: unknown; platform?: unknown; version?: unknown }): AppIdentity | null {
  const r = identitySchema.safeParse(raw)
  return r.success ? r.data : null
}

/** X-App-Name / X-App-Platform / X-App-Version, or null when absent or malformed (web portals, old builds). */
export function identityFromHeaders(headers: Record<string, unknown>): AppIdentity | null {
  return parseIdentity({
    app: headers['x-app-name'],
    platform: headers['x-app-platform'],
    version: headers['x-app-version'],
  })
}

export interface VersionPolicy {
  action: UpdateAction
  min_supported: string
  recommended: string
  store_url: string | null
}

export async function getVersionPolicy(id: AppIdentity): Promise<VersionPolicy> {
  const [enabled, min, recommended] = await Promise.all([
    getConfigValue('app_update_enabled', 'true'),
    getConfigValue(`app_update_${id.app}_${id.platform}_min`, '0.0.0'),
    getConfigValue(`app_update_${id.app}_${id.platform}_recommended`, '0.0.0'),
  ])
  return {
    action: enabled === 'true' ? decideAction(id.version, min, recommended) : 'none',
    min_supported: min,
    recommended,
    store_url: getStoreUrl(id.app, id.platform),
  }
}
