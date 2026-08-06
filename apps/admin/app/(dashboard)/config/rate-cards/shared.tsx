export const CATEGORY_ORDER = ['hatchback', 'sedan', 'suv', 'luxury', 'van']

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h}h ${m}m`
}

export function numFmt(v: string): string {
  return `₹${parseFloat(v).toFixed(2)}`
}

export function SkeletonRows({ cols, n }: { cols: number; n: number }) {
  return <>{Array.from({ length: n }).map((_, i) => (
    <tr key={i} className="border-b border-border-light last:border-b-0">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-4 py-3.5">
          <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: `${45 + (j * 20) % 45}%` }} />
        </td>
      ))}
    </tr>
  ))}</>
}

export const inputCls = 'w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted'
export const labelCls = 'block text-xs font-semibold text-text-muted mb-1.5'
