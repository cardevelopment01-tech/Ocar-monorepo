'use client'
import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Dashboard error]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <div className="w-14 h-14 rounded-2xl bg-danger-light flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-danger" />
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-text-primary mb-1">Something went wrong</p>
        <p className="text-sm text-text-muted max-w-xs">
          {error.message || 'An unexpected error occurred loading this page.'}
        </p>
      </div>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
