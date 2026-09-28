import type { ReportFilters, ReportTab } from '@/lib/reports-range'
import type { EmptyAction } from './WidgetStates'

export interface ReportCtx {
  filters: ReportFilters
  patch: (p: Partial<ReportFilters>) => void
  /** finance class = super_admin / finance_admin; everyone else is ops and never receives money */
  isFinance: boolean
  goTab: (t: ReportTab) => void
}

/** The one action that fixes the likely cause of an empty widget (design D4); null when there is none. */
export function emptyActionFor(ctx: ReportCtx): EmptyAction | null {
  const f = ctx.filters
  if (f.cityIds.length > 0 || f.categoryId) {
    return { label: 'Clear city and category filters', onClick: () => ctx.patch({ cityIds: [], categoryId: null }) }
  }
  const days = (Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86_400_000 + 1
  if (days < 90) return { label: 'Show last 90 days', onClick: () => ctx.patch({ range: '90d' }) }
  return null
}
