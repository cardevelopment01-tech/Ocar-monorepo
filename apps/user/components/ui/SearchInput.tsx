'use client'

import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  placeholder?: string
  className?: string
  readOnly?: boolean
}

export default function SearchInput({
  value,
  onChange,
  onFocus,
  placeholder = 'Where to?',
  className,
  readOnly,
}: SearchInputProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 bg-surface-2 rounded-full px-4 py-3.5',
        'border border-border transition-all duration-150',
        'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10',
        className
      )}
    >
      <Search className="w-5 h-5 text-text-muted shrink-0" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        readOnly={readOnly}
        className="flex-1 bg-transparent text-text-primary placeholder-text-muted text-base focus:outline-none"
      />
      {value && !readOnly && (
        <button
          onClick={() => onChange('')}
          className="shrink-0 w-5 h-5 rounded-full bg-text-muted/20 flex items-center justify-center"
        >
          <X className="w-3 h-3 text-text-muted" />
        </button>
      )}
    </div>
  )
}
