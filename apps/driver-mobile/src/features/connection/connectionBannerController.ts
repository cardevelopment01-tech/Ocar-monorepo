// What the driver should be told about their connection. Pure logic (no React, no socket) so the timing rules can be tested.
//
//   hidden        nothing to say (connected, or the driver is not online, or the app is in the background)
//   lost          the connection has been down long enough to matter: requests cannot reach the phone right now
//   reconnecting  the app is actively retrying
//   restored      back again; shown briefly, then hidden
//
// A short blip (a tunnel, a signal flicker) must not flash a banner at a driver who is driving, so "lost" only appears after SHOW_AFTER_MS of
// continuous disconnection, and "restored" only follows a banner that was actually shown.
export type ConnectionBannerKind = 'hidden' | 'lost' | 'reconnecting' | 'restored'

export const SHOW_AFTER_MS = 4000
export const RESTORED_VISIBLE_MS = 2600

export type ConnectionBannerController = {
  setActive: (active: boolean) => void
  setConnected: (connected: boolean) => void
  reconnectAttempt: () => void
  dispose: () => void
}

export function createConnectionBannerController(
  onChange: (kind: ConnectionBannerKind) => void,
  opts: { showAfterMs?: number; restoredMs?: number } = {},
): ConnectionBannerController {
  const showAfterMs = opts.showAfterMs ?? SHOW_AFTER_MS
  const restoredMs = opts.restoredMs ?? RESTORED_VISIBLE_MS
  let kind: ConnectionBannerKind = 'hidden'
  let connected = true
  let active = false
  let showTimer: ReturnType<typeof setTimeout> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  const set = (next: ConnectionBannerKind) => { if (next !== kind) { kind = next; onChange(next) } }
  const clearTimers = () => { clearTimeout(showTimer); clearTimeout(hideTimer); showTimer = undefined; hideTimer = undefined }

  const evaluate = () => {
    if (!active) { clearTimers(); set('hidden'); return }
    if (connected) {
      clearTimeout(showTimer); showTimer = undefined
      if (kind === 'lost' || kind === 'reconnecting') {
        set('restored')
        clearTimeout(hideTimer)
        hideTimer = setTimeout(() => set('hidden'), restoredMs)
      }
      return
    }
    // disconnected
    clearTimeout(hideTimer); hideTimer = undefined
    if (kind === 'restored') set('hidden')
    if (kind === 'hidden' && showTimer === undefined) showTimer = setTimeout(() => { showTimer = undefined; if (!connected && active) set('lost') }, showAfterMs)
  }

  return {
    setActive(next) { active = next; evaluate() },
    setConnected(next) { connected = next; evaluate() },
    reconnectAttempt() { if (active && !connected && kind === 'lost') set('reconnecting') },
    dispose() { clearTimers() },
  }
}
