'use client'
import { cn } from '@/lib/utils'

interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  width?: string
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  data: T[]
  onRowClick?: (row: T) => void
  isLoading?: boolean
  emptyMessage?: string
  emptyIcon?: React.ReactNode
  /** keep the first column pinned while the table scrolls sideways below 1280px */
  pinFirstColumn?: boolean
}

const PIN_CLASS = 'max-[1279px]:sticky max-[1279px]:left-0 max-[1279px]:z-[1] max-[1279px]:bg-surface'

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3.5 border-b border-border-light">
          <div className={cn('skeleton h-4 rounded', i === 0 ? 'w-32' : i === 1 ? 'w-24' : 'w-16')} />
        </td>
      ))}
    </tr>
  )
}

export default function DataTable<T extends Record<string, unknown>>({
  columns, data, onRowClick, isLoading = false, emptyMessage = 'No records found', emptyIcon, pinFirstColumn = false,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col, ci) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined} className={pinFirstColumn && ci === 0 ? PIN_CLASS : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={columns.length} />)
            : data.length === 0
              ? (
                <tr>
                  <td colSpan={columns.length} className="!border-0">
                    <div className="flex flex-col items-center justify-center py-16 text-text-muted">
                      {emptyIcon ?? (
                        <div className="w-12 h-12 rounded-2xl bg-surface-2 flex items-center justify-center mb-3">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4m8-5v5"/></svg>
                        </div>
                      )}
                      <p className="text-sm font-medium">{emptyMessage}</p>
                    </div>
                  </td>
                </tr>
              )
              : data.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => onRowClick?.(row)}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {columns.map((col, ci) => (
                    <td key={col.key} className={pinFirstColumn && ci === 0 ? PIN_CLASS : undefined}>
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
          }
        </tbody>
      </table>
    </div>
  )
}
