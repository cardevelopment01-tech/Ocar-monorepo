import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, X, Search } from 'lucide-react'

interface SelectSheetProps {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  searchable?: boolean
}

export default function SelectSheet({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  searchable = false,
}: SelectSheetProps) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const searchRef             = useRef<HTMLInputElement>(null)
  const triggerRef            = useRef<HTMLButtonElement>(null)

  const filtered = query.trim()
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options

  function openSheet() {
    if (disabled) return
    setOpen(true)
    setQuery('')
  }

  function closeSheet() {
    setOpen(false)
    setQuery('')
    // Return focus to trigger so form flow isn't disrupted
    setTimeout(() => triggerRef.current?.focus(), 50)
  }

  function select(v: string) {
    onChange(v)
    closeSheet()
  }

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus search if searchable, otherwise sheet itself gets focus
    if (searchable) setTimeout(() => searchRef.current?.focus(), 80)
    return () => { document.body.style.overflow = prev }
  }, [open, searchable])

  // Escape key dismisses
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSheet() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={openSheet}
        disabled={disabled}
        className="input-dark w-full flex items-center justify-between gap-2 text-left"
        style={{ minHeight: 52 }}
      >
        <span className={value ? 'text-text-primary font-medium' : 'text-text-muted font-normal'}>
          {value || placeholder}
        </span>
        <ChevronDown
          size={18}
          className="text-text-muted flex-shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Sheet — rendered in a portal to escape any transform ancestor */}
      {open && createPortal(
        <div className="fixed inset-0" style={{ zIndex: 50 }}>
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeSheet}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="absolute bottom-0 inset-x-0 flex flex-col bg-white rounded-t-3xl"
            style={{
              maxHeight: '75vh',
              boxShadow: '0 -4px 32px rgba(0,0,0,0.12)',
              animation: 'slideUpSheet 220ms cubic-bezier(0.22,1,0.36,1) both',
            }}
          >
            {/* Handle + header */}
            <div className="flex-shrink-0 px-4 pt-3 pb-2">
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between mb-3">
                <p className="text-base font-bold text-slate-800">{label}</p>
                <button
                  type="button"
                  onClick={closeSheet}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100"
                  aria-label="Close"
                >
                  <X size={15} className="text-slate-500" />
                </button>
              </div>

              {/* Search input */}
              {searchable && (
                <div className="relative mb-2">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={`Search ${label.toLowerCase()}…`}
                    className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>
              )}
            </div>

            {/* Options list */}
            <ul
              className="overflow-y-auto overscroll-contain px-2 pb-4 flex-1"
              style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
            >
              {filtered.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-slate-400">No results</li>
              ) : filtered.map(opt => {
                const isSelected = opt === value
                return (
                  <li key={opt}>
                    <button
                      type="button"
                      onClick={() => select(opt)}
                      className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left transition-colors active:bg-blue-50"
                      style={{ background: isSelected ? 'rgba(37,99,235,0.06)' : 'transparent' }}
                    >
                      <span className={`text-sm font-${isSelected ? 'semibold' : 'medium'} ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                        {opt}
                      </span>
                      {isSelected && <Check size={16} className="text-blue-600 flex-shrink-0" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>,
        document.body,
      )}

      <style>{`
        @keyframes slideUpSheet {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
