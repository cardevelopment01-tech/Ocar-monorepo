import { useEffect } from 'react'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
import { warmUpSpeech } from './speech'

// Once per app start, as soon as the driver's settings are loaded and the voice is on.
export function useWarmSpeech(): void {
  const ready = useAlertPrefsStore((s) => s.hasHydrated)
  const voiceEnabled = useAlertPrefsStore((s) => s.voiceEnabled)
  useEffect(() => {
    if (ready && voiceEnabled) warmUpSpeech()
  }, [ready, voiceEnabled])
}
