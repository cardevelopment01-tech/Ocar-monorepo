'use client'
import { Search, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilterOption {
  key: string
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}

interface FilterBarProps {
  search: string
  onSearch: (v: string) => void
  searchPlaceholder?: string
  filters?: FilterOption[]
  onExport?: () => void
  actions?: React.ReactNode
}

export default function FilterBar({
  search, onSearch, searchPlaceholder = 'Search…',
  filters = [], onExport, actions,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={search}
          onChange={e => onSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-sm bg-surface border border-border rounded-xl text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Filter dropdowns */}
      {filters.map(f => (
        <select
          key={f.key}
          value={f.value}
          onChange={e => f.onChange(e.target.value)}
          className="px-3 py-2 text-sm bg-surface border border-border rounded-xl text-text-secondary focus:outline-none focus:border-primary cursor-pointer transition-colors"
        >
          <option value="">{f.label}</option>
          {f.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}

      {actions}

      {/* Export */}
      {onExport && (
        <button
          onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 transition-colors ml-auto"
        >
          <Download size={14} />
          Export CSV
        </button>
      )}
    </div>
  )
}
