import { MapPin, LoaderCircle } from 'lucide-react'

const GLASS = {
  background:           'rgba(255,255,255,0.94)',
  backdropFilter:       'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border:               '1px solid rgba(0,0,0,0.07)',
  boxShadow:            '0 2px 16px rgba(0,0,0,0.12)',
}

interface LocationChipProps {
  text:    string | null
  loading: boolean
}

export default function LocationChip({ text, loading }: LocationChipProps) {
  if (!text && !loading) return null

  return (
    <div
      className="pointer-events-auto flex items-center gap-2 rounded-full pl-2.5 pr-3.5 py-2 max-w-[80%]"
      style={GLASS}
    >
      {/* Orange pin badge */}
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(249,115,22,0.12)' }}
      >
        <MapPin size={13} style={{ color: '#2563EB' }} strokeWidth={2.2} />
      </span>

      {loading && !text ? (
        <span className="flex items-center gap-1.5 text-text-muted text-[12px] font-medium">
          <LoaderCircle size={12} className="animate-spin" />
          Locating…
        </span>
      ) : (
        <span className="text-text-primary text-[12.5px] font-semibold leading-tight truncate">
          {text}
        </span>
      )}
    </div>
  )
}
