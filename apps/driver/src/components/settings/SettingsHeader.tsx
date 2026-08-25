import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

interface SettingsHeaderProps {
  title: string
  subtitle?: string
}

// Flat header for post-onboarding settings screens: back always goes to
// Profile, no step count, no progress bar. Deliberately not OnboardingShell —
// settings screens have no sequence, so they get no stepper chrome.
export default function SettingsHeader({ title, subtitle }: SettingsHeaderProps) {
  const navigate = useNavigate()

  return (
    <header
      className="flex-shrink-0 bg-bg px-5 pb-4"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 1.5rem)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/profile')}
          aria-label="Back to profile"
          className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0 active:scale-[0.97] transition-transform"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="text-text-muted text-xs mt-0.5">{subtitle}</p>}
        </div>
      </div>
    </header>
  )
}
