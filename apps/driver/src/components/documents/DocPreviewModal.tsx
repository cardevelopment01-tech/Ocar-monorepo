import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function DocPreviewModal({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const isPdf = /\.pdf($|\?)/i.test(url) || url.includes('application%2Fpdf')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // overflow-hidden prevents body scroll leaking into the modal
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden" style={{ background: '#0d0d0d' }}>

      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          paddingTop: 'max(1rem, env(safe-area-inset-top))',
          paddingBottom: '0.875rem',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 active:opacity-70 transition-opacity"
          style={{ background: 'rgba(255,255,255,0.12)' }}
        >
          <X size={20} className="text-white" strokeWidth={2.5} />
        </button>
        <p className="flex-1 text-white text-[15px] font-semibold truncate">{label}</p>
      </div>

      {/* Document: min-h-0 allows flex-1 to shrink below natural content height */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4">
        {isPdf
          ? <iframe src={url} title={label} className="w-full h-full rounded-2xl bg-white" style={{ border: 'none' }} />
          : <img src={url} alt={label} className="max-w-full max-h-full object-contain rounded-2xl select-none" draggable={false} style={{ touchAction: 'pan-x pan-y pinch-zoom' }} />}
      </div>

      {/* Hint */}
      <div
        className="flex-shrink-0 flex justify-center"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))', paddingTop: '0.5rem' }}
      >
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>Pinch to zoom</p>
      </div>
    </div>
  )
}
