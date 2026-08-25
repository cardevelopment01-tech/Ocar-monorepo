import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Check, Search, X } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'

interface Option {
  value: string | number
  label: string
}

interface InlineSelectProps {
  value: string | number | null
  options: Option[]
  onChange: (v: string | number) => void
  placeholder?: string
  disabled?: boolean
  disabledPlaceholder?: string
  searchable?: boolean
  loading?: boolean
}

export default function InlineSelect({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  disabledPlaceholder,
  searchable = false,
  loading = false,
}: InlineSelectProps) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const rootRef           = useRef<HTMLDivElement>(null)
  const searchRef         = useRef<HTMLInputElement>(null)

  const selectedLabel = options.find(o => o.value === value)?.label ?? null

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  function toggle() {
    if (disabled || loading) return
    setOpen(p => !p)
    setQuery('')
  }

  function select(opt: Option) {
    onChange(opt.value)
    setOpen(false)
    setQuery('')
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus search on open
  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 40)
    }
  }, [open, searchable])

  // Escape closes
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setQuery('') } }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const isDisabled = disabled || loading

  return (
    <div ref={rootRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={toggle}
        disabled={isDisabled}
        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl border text-left transition-[background-color,border-color,box-shadow] duration-150"
        style={{
          minHeight: 52,
          background: open ? '#E4F8FA' : '#FFFFFF',
          borderColor: open ? '#3B82F6' : '#E2E8F0',
          boxShadow: open ? '0 0 0 3px rgba(59,130,246,0.12)' : '0 1px 2px rgba(0,0,0,0.04)',
          opacity: isDisabled ? 0.5 : 1,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span className={`text-sm font-medium truncate ${selectedLabel ? 'text-slate-800' : 'text-slate-400'}`}>
          {loading
            ? 'Loading…'
            : isDisabled && disabledPlaceholder
            ? disabledPlaceholder
            : selectedLabel ?? placeholder}
        </span>
        {loading ? (
          <OcarSpinner size={16} variant="color" className="flex-shrink-0" />
        ) : (
          <ChevronDown
            size={17}
            className="text-slate-400 flex-shrink-0 transition-transform duration-200"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        )}
      </button>

      {/* Inline dropdown */}
      {open && (
        <div
          className="absolute left-0 right-0 mt-1.5 rounded-2xl border border-slate-200 bg-white overflow-hidden"
          style={{
            zIndex: 20,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            animation: 'inlineDropDown 160ms cubic-bezier(0.22,1,0.36,1) both',
          }}
        >
          {/* Search */}
          {searchable && (
            <div className="px-3 pt-3 pb-2 border-b border-slate-100">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-8 pr-8 py-2 text-sm rounded-lg bg-slate-50 border border-slate-200 text-slate-700 placeholder-slate-400 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100 transition-[border-color,box-shadow]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center"
                  >
                    <X size={12} className="text-slate-400" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options */}
          <ul className="overflow-y-auto overscroll-contain" style={{ maxHeight: 210 }}>
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-400">No results</li>
            ) : filtered.map(opt => {
              const isSelected = opt.value === value
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => select(opt)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-blue-50"
                    style={{ background: isSelected ? 'rgba(59,130,246,0.06)' : undefined }}
                  >
                    <span className={`text-sm ${isSelected ? 'font-semibold text-blue-700' : 'font-medium text-slate-700'}`}>
                      {opt.label}
                    </span>
                    {isSelected && <Check size={15} className="text-blue-600 flex-shrink-0" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <style>{`
        @keyframes inlineDropDown {
          from { opacity: 0; transform: scaleY(0.92) translateY(-6px); transform-origin: top; }
          to   { opacity: 1; transform: scaleY(1) translateY(0);        transform-origin: top; }
        }
      `}</style>
    </div>
  )
}
