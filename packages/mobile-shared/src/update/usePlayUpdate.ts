import { useCallback, useEffect, useState } from 'react'
import { playUpdate, type PlayUpdateInfo, type PlayUpdateResult } from '@ocar/expo-play-update'
import { PLAY_STATUS, downloadPercent, phaseFromStatus, type PlayPhase } from './playModel'

/**
 * Google Play in-app update state (Android with the native module; inert elsewhere).
 * Never restarts the app by itself: `restart()` is only called from the user's tap.
 */
export function usePlayUpdate() {
  const [info, setInfo] = useState<PlayUpdateInfo | null>(null)
  const [phase, setPhase] = useState<PlayPhase>('idle')
  const [percent, setPercent] = useState<number | null>(null)

  useEffect(() => {
    if (!playUpdate) return
    const sub = playUpdate.addListener('onState', (s) => {
      setPhase(phaseFromStatus(s.status))
      setPercent(downloadPercent(s.bytesDownloaded, s.totalBytes))
    })
    return () => sub.remove()
  }, [])

  /** Call on launch and every time the app returns to the foreground. */
  const refresh = useCallback(async () => {
    if (!playUpdate) return
    try {
      const i = await playUpdate.getInfo()
      setInfo(i)
      // Downloaded while we were in the background / killed: offer the restart again.
      if (i.installStatus === PLAY_STATUS.DOWNLOADED) setPhase('downloaded')
      // An immediate update was interrupted (app killed mid-update): Play requires resuming it.
      if (i.inProgress) void playUpdate.start('immediate')
    } catch { /* leave info as is */ }
  }, [])

  const start = useCallback(async (type: 'flexible' | 'immediate'): Promise<PlayUpdateResult> => {
    if (!playUpdate) return 'failed'
    try { return await playUpdate.start(type) } catch { return 'failed' }
  }, [])

  const restart = useCallback(() => { void playUpdate?.complete() }, [])

  return { available: !!playUpdate, info, phase, percent, refresh, start, restart, setPhase }
}
