// The alarm for a new SOS alert: a two-tone beep and, if the admin allowed it, a desktop notification, so an alert is noticed
// from another tab or window. The mute choice is kept in this browser. Every call is safe where audio or notifications do not exist.

const MUTE_KEY = 'ocar_sos_alarm_muted'
let ctx: AudioContext | null = null

export function isAlarmMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}
export function setAlarmMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* private window: the choice lasts until reload */ }
}

/** Call from a click: browsers only let a page make sound after the person has interacted with it. */
export function primeAlarm(): void {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
  } catch { /* no audio */ }
}

export function soundAlarm(): void {
  if (isAlarmMuted()) return
  try {
    ctx ??= new AudioContext()
    const c = ctx
    void c.resume()
    // Three rising double-beeps, about two seconds: hard to miss, short enough not to be a siren.
    for (let i = 0; i < 3; i++) {
      for (const [j, hz] of [880, 1175].entries()) {
        const t = c.currentTime + i * 0.7 + j * 0.2
        const osc = c.createOscillator()
        const gain = c.createGain()
        osc.type = 'square'
        osc.frequency.value = hz
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
        osc.connect(gain).connect(c.destination)
        osc.start(t)
        osc.stop(t + 0.2)
      }
    }
  } catch { /* no audio */ }
}

export function notifyDesktop(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(title, { body, tag: 'ocar-sos', requireInteraction: true })
  } catch { /* not allowed here */ }
}

export function desktopPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}
export function askDesktopPermission(): void {
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission() } catch { /* ignore */ }
}
