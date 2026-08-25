import type { CSSProperties } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useNavPrefsStore } from '@/store/useNavPrefsStore'

interface VoiceToggleButtonProps {
  style?: CSSProperties
}

export default function VoiceToggleButton({ style }: VoiceToggleButtonProps) {
  const voiceEnabled = useNavPrefsStore(s => s.voiceEnabled)
  const setVoiceEnabled = useNavPrefsStore(s => s.setVoiceEnabled)

  return (
    <button
      aria-label={voiceEnabled ? 'Mute voice guidance' : 'Unmute voice guidance'}
      onClick={() => {
        if (voiceEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel()
        }
        setVoiceEnabled(!voiceEnabled)
      }}
      className="w-12 h-12 rounded-2xl bg-surface border border-border shadow-lg flex items-center justify-center active:scale-[0.97] transition-transform"
      style={{ position: 'fixed', zIndex: 50, minHeight: 48, minWidth: 48, ...style }}
    >
      {voiceEnabled
        ? <Volume2 size={20} className="text-primary" />
        : <VolumeX size={20} className="text-text-muted" />}
    </button>
  )
}
