import { useEffect } from 'react'

/**
 * Keeps the screen awake for as long as the calling component is mounted. Re-acquires
 * on page resume, since the browser auto-releases WakeLock when the page is hidden.
 */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const acquire = () => {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
      }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      document.removeEventListener('visibilitychange', acquire)
      lock?.release()
    }
  }, [])
}
