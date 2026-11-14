// The go-online sequence, with every effect injected so it can be tested without rendering the screen.
//
// Order: position -> server call -> mark online -> socket -> Home. Background tracking is started AFTER the driver is already on Home:
// it used to be awaited before leaving the screen (about 3 s of spinner on a real phone) although nothing on Home needs it first.
//
// Once the server has said yes the session is live, so nothing after that may turn into "Failed to go online": each later step that can
// fail is isolated and reported instead. A failed tracking start is retried once, then reported (the hook shows a warning on Home so the
// driver is never left "online" without knowing tracking is off), and a start is never attempted for a driver who has gone offline since.
// useSessionResync also re-arms tracking each time the app returns to the foreground.

export type GoOnlineStep = 'socket' | 'home' | 'after_online' | 'tracking'

export type GoOnlineDeps = {
  getPosition: () => Promise<{ coords: { latitude: number; longitude: number } }>
  callApi: (p: { lat: number; lng: number }) => Promise<{ id: string }>
  markOnline: (sessionId: string) => void
  connectSocket: () => void
  goHome: () => void
  /** Runs after Home is shown (for example the one-time overlay permission prompt). */
  afterOnline: () => void
  startTracking: () => Promise<void>
  /** False once the driver has gone offline: a tracking start must not run for them. */
  isStillOnline: () => boolean
  reportError: (err: unknown, where: GoOnlineStep) => void
  /** Used when no position is available at all. */
  defaultPosition: { lat: number; lng: number }
  retryDelayMs: number
  wait: (ms: number) => Promise<void>
}

export type GoOnlineResult = {
  /** True when no position was available and the default centre was sent. */
  locationWarning: boolean
  /** Resolves when background tracking has started or has been given up on. Never rejects; callers do not need to await it. */
  tracking: Promise<void>
}

async function startTrackingWithRetry(d: GoOnlineDeps): Promise<void> {
  if (!d.isStillOnline()) return
  try {
    await d.startTracking()
    return
  } catch {
    // one retry after a short pause: the foreground service can refuse right as the screen changes
  }
  try {
    await d.wait(d.retryDelayMs)
    if (!d.isStillOnline()) return
    await d.startTracking()
  } catch (err) {
    d.reportError(err, 'tracking')
  }
}

function safely(d: GoOnlineDeps, where: GoOnlineStep, step: () => void): void {
  try {
    step()
  } catch (err) {
    d.reportError(err, where)
  }
}

export async function runGoOnline(d: GoOnlineDeps): Promise<GoOnlineResult> {
  let lat = d.defaultPosition.lat
  let lng = d.defaultPosition.lng
  let locationWarning = false
  try {
    const position = await d.getPosition()
    lat = position.coords.latitude
    lng = position.coords.longitude
  } catch {
    locationWarning = true
  }

  const session = await d.callApi({ lat, lng }) // a refusal throws here, before anything has changed
  d.markOnline(session.id)
  safely(d, 'socket', d.connectSocket)
  safely(d, 'home', d.goHome)
  safely(d, 'after_online', d.afterOnline)
  return { locationWarning, tracking: startTrackingWithRetry(d) }
}
