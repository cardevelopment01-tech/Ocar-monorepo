import { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

const STEPS = ['personal_info', 'vehicle_info', 'documents', 'selfie'] as const

interface OnboardingShellProps {
  stepIndex: number
  title: string
  subtitle?: string
  children: ReactNode
  footer: ReactNode
  onBack?: () => void
}

export default function OnboardingShell({
  stepIndex,
  title,
  subtitle = 'Progress is saved automatically',
  children,
  footer,
  onBack,
}: OnboardingShellProps) {
  const navigate = useNavigate()
  // Clamp so a bad stepIndex (-1 or out-of-range) never hides all bars
  const activeIdx = Math.min(Math.max(stepIndex, 0), STEPS.length - 1)

  return (
    <div className="flex flex-col h-[100dvh] bg-bg text-text-primary">

      {/* ── Header: back/title first, progress bars last (act as visual divider) ── */}
      <header
        className="flex-shrink-0 bg-bg px-5 pb-4"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 1.5rem)',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onBack ?? (() => navigate(-1))}
            aria-label="Go back"
            className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0 active:scale-[0.97] transition-transform"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div className="min-w-0">
            <p className="text-text-muted text-xs font-medium">Step {activeIdx + 1} of {STEPS.length}</p>
            <h1 className="text-xl font-bold leading-tight">{title}</h1>
          </div>
        </div>

        {/* Step bars, bg-border inactive for clear contrast on #F5F8FF bg */}
        <div
          className="flex gap-1.5"
          role="progressbar"
          aria-valuenow={activeIdx + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
        >
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-1.5 rounded-full transition-colors duration-300 ${
                i <= activeIdx ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>
      </header>

      {/* ── Scrollable content: only this region scrolls ── */}
      <main className="flex-1 overflow-y-auto px-5 pt-6 pb-4">
        {subtitle && <p className="text-text-muted text-xs mb-5">{subtitle}</p>}
        {children}
      </main>

      {/* ── Footer: always at bottom of flex column ── */}
      <footer
        className="flex-shrink-0 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-bg/95 backdrop-blur-sm"
        style={{ boxShadow: '0 -1px 2px rgba(15,23,42,0.04)' }}
      >
        {footer}
      </footer>

    </div>
  )
}
