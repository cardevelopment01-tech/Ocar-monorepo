// The go-online sequence, with every effect injected so it can be tested without rendering the screen.
//
// Order: position -> server call -> mark online -> socket -> Home. Background tracking is started AFTER the driver is already on Home:
// it used to be awaited before leaving the screen (about 3 s of spinner on a real phone) although nothing on Home needs it first.
// A failed tracking start is retried once and then reported; it must not turn a successful go-online into "Failed to go online" (the
// session is already live on the server by then). useSessionResync also re-arms tracking each time the app returns to the foreground.

export type GoOnlineDeps = {
  getPosition: () => Promise<{ coords: { latitude: number; longitude: number } }>
  callApi: (p: { lat: number; lng: number }) => Promise<{ id: string }>
  markOnline: (sessionId: string) => void
  connectSocket: () => void
  goHome: () => void
  /** Runs after Home is shown (for example the one-time overlay permission prompt). */
  afterOnline: () => void
  startTracking: () => Promise<void>
  reportTrackingFailure: (err: unknown) => void
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
  try {
    await d.startTracking()
    return
  } catch {
    // one retry after a short pause: the foreground service can refuse right as the screen changes
  }
  try {
    await d.wait(d.retryDelayMs)
    await d.startTracking()
  } catch (err) {
    d.reportTrackingFailure(err)
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
  d.connectSocket()
  d.goHome()
  d.afterOnline()
  return { locationWarning, tracking: startTrackingWithRetry(d) }
}
