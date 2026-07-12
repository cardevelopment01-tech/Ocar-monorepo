import { useState } from 'react'
import type { CSSProperties } from 'react'
import { ShieldAlert } from 'lucide-react'

interface SOSButtonProps {
  rideId: string
  onSOS: () => void | Promise<void>
  /** Trigger button's own classes — callers own placement (inline in a sheet
   *  header, fixed over the map, etc). Defaults to a fixed bottom-right dot
   *  for screens that don't pass their own. */
  className?: string
  style?: CSSProperties
}

export default function SOSButton({
  rideId: _rideId, onSOS,
  className = 'fixed w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center active:scale-95 transition-transform',
  style,
}: SOSButtonProps) {
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSend = async () => {
    setSending(true)
    try {
      await Promise.resolve(onSOS())
      setSent(true)
      setTimeout(() => {
        setSent(false)
        setConfirming(false)
      }, 2500)
    } catch {
      setConfirming(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className={className}
        style={{ minHeight: 44, minWidth: 44, ...style }}
        aria-label="SOS — safety toolkit"
      >
        <ShieldAlert size={18} className="text-accent-red" strokeWidth={2.25} />
      </button>

      {confirming && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70">
          <div className="bg-surface rounded-t-3xl w-full max-w-[430px] p-6 pb-10">
            <div className="w-12 h-1.5 rounded-full bg-surface-3 mx-auto mb-6" />
            {sent ? (
              <>
                <div className="w-14 h-14 rounded-full bg-accent-green/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-accent-green font-bold text-2xl">✓</span>
                </div>
                <h2 className="text-text-primary font-bold text-xl text-center mb-2">SOS Alert Sent</h2>
                <p className="text-text-secondary text-sm text-center">Help is on the way. Stay safe.</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-accent-red/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-accent-red font-bold text-xl">!</span>
                </div>
                <h2 className="text-text-primary font-bold text-xl text-center mb-2">Send SOS Alert?</h2>
                <p className="text-text-secondary text-sm text-center mb-8">
                  This will immediately alert emergency contacts and share your location.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={sending}
                    className="btn-secondary-dark flex-1"
                    style={{ minHeight: 56 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleSend()}
                    disabled={sending}
                    className="btn-danger flex-1"
                    style={{ minHeight: 56 }}
                  >
                    {sending ? 'Sending…' : 'Send SOS'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
