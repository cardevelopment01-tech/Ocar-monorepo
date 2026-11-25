// Is the phone really reporting this driver's location? Pure rules, kept apart from the hook so they are unit-testable.
//
// The server pauses an online driver whose phone goes quiet (no ride requests until it hears from them again), and until now the driver
// found out only by noticing the silence. These rules name the cause so the app can say so at once and offer the one tap that fixes it.

export type TrackingIssue = 'permission' | 'background_permission' | 'services_off' | 'not_running' | 'no_signal'

export type TrackingSnapshot = {
  foregroundGranted: boolean
  /** "Allow all the time": without it Android stops location once the screen is off or the app is in the background. */
  backgroundGranted: boolean
  /** The phone's own Location switch (the quick-settings toggle). */
  servicesEnabled: boolean
  /** The background location task is registered and running. */
  taskRunning: boolean
  /** Milliseconds since the last live fix reached this app, or null if none yet. */
  lastFixAgeMs: number | null
  /** Milliseconds since the driver went online (or since tracking was first checked this session). */
  sinceOnlineMs: number
}

/** A quiet GPS is normal for a short while (a tunnel, a garage). Past this the driver should hear about it. Longer than the 2-minute rough-fix
 *  fallback (locationPolicy DEGRADED_AFTER_MS) on purpose: a garage that still yields a rough fix every 2 minutes is not "no signal", and the
 *  card must not flip between warning and "Location is back" every cycle. */
export const NO_SIGNAL_AFTER_MS = 150_000

/** Starting the tracking service takes a few seconds on a real phone, so "not running" is not reported until the driver has been online this long. */
export const START_GRACE_MS = 30_000

/** The most fundamental cause first: a missing permission explains everything below it. */
export function assessTracking(s: TrackingSnapshot): TrackingIssue | null {
  if (!s.foregroundGranted) return 'permission'
  if (!s.backgroundGranted) return 'background_permission'
  if (!s.servicesEnabled) return 'services_off'
  if (!s.taskRunning && s.sinceOnlineMs >= START_GRACE_MS) return 'not_running'
  const quietFor = s.lastFixAgeMs ?? s.sinceOnlineMs
  if (quietFor >= NO_SIGNAL_AFTER_MS) return 'no_signal'
  return null
}

/** Permission and switch problems are certain the moment they are read. "Not running" and "no signal" can be a passing blip or a start still in
 *  progress, so they must be seen on two checks in a row before the driver is bothered. */
export const NEEDS_CONFIRMATION: ReadonlySet<TrackingIssue> = new Set(['not_running', 'no_signal'])

export type TrackingAction = 'app_settings' | 'location_settings' | 'restart'

export type IssueCopy = { title: string; message: string; action?: TrackingAction; actionLabel?: string; tone: 'warning' | 'info' }

// Plain, calm, one next step. Says what the driver is missing (ride requests), never blames them.
export const ISSUE_COPY: Record<TrackingIssue, IssueCopy> = {
  permission: {
    title: 'Location permission is off',
    message: "Ocar can't see where you are, so ride requests are paused.",
    action: 'app_settings', actionLabel: 'Open settings', tone: 'warning',
  },
  background_permission: {
    title: 'Allow location all the time',
    message: "Without it, requests stop when your screen turns off. In Settings, choose Location, then 'Allow all the time'.",
    action: 'app_settings', actionLabel: 'Open settings', tone: 'warning',
  },
  services_off: {
    title: 'Your phone location is off',
    message: 'Turn it on so Ocar can send you ride requests.',
    action: 'location_settings', actionLabel: 'Turn on', tone: 'warning',
  },
  not_running: {
    title: 'Location sharing stopped',
    message: "You may miss ride requests until it's back on.",
    action: 'restart', actionLabel: 'Restart', tone: 'warning',
  },
  no_signal: {
    title: 'Waiting for GPS',
    message: 'Move to open sky or away from tall buildings. Requests resume when your location is back.',
    tone: 'info',
  },
}
