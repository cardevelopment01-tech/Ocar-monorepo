'use client'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import ReportFilterBar, { ReportActions, type FilterOption } from '@/components/reports/ReportFilterBar'
import ReportTabs from '@/components/reports/ReportTabs'
import OverviewTab from '@/components/reports/OverviewTab'
import DemandTab from '@/components/reports/DemandTab'
import DriversTab from '@/components/reports/DriversTab'
import FinanceTab from '@/components/reports/FinanceTab'
import SuccessToast from '@/components/ui/SuccessToast'
import { useAdminAuth } from '@/lib/auth-context'
import { cityApi } from '@/lib/city-api'
import { vehicleCategoryApi } from '@/lib/vehicle-api'
import { reportsApi } from '@/lib/reports-api'
import { MOTION, prefersReducedMotion } from '@/lib/motion'
import { parseFilters, toSearchParams, TABS, type ReportFilters, type ReportTab } from '@/lib/reports-range'
import type { ReportCtx } from '@/components/reports/report-context'

const EXPORT_TAB: Record<ReportTab, 'daily' | 'drivers' | 'cities'> = {
  overview: 'daily', finance: 'daily', drivers: 'drivers', demand: 'cities',
}

function ReportsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { admin } = useAdminAuth()
  const isFinance = admin?.role === 'super_admin' || admin?.role === 'finance_admin'

  const parsed = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params])
  // ops never sees the Finance tab; a pasted ?tab=finance falls back to Overview
  const tabs = useMemo(() => TABS.filter(t => t !== 'finance' || isFinance), [isFinance])
  const filters: ReportFilters = useMemo(() => (tabs.includes(parsed.tab) ? parsed : { ...parsed, tab: 'overview' }), [parsed, tabs])

  const patch = useCallback((p: Partial<ReportFilters>) => {
    const next = { ...filters, ...p }
    const qs = toSearchParams(next).toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [filters, pathname, router])

  const ctx: ReportCtx = useMemo(() => ({ filters, patch, isFinance, goTab: (t: ReportTab) => patch({ tab: t }) }), [filters, patch, isFinance])

  const [cities, setCities] = useState<FilterOption[]>([])
  const [categories, setCategories] = useState<FilterOption[]>([])
  useEffect(() => {
    void cityApi.list().then(cs => setCities(cs.filter(c => c.status === 'active').map(c => ({ value: String(c.id), label: c.name })))).catch(() => undefined)
    void vehicleCategoryApi.list().then(cs => setCategories(cs.filter(c => c.is_active).map(c => ({ value: c.id, label: c.display_name })))).catch(() => undefined)
  }, [])

  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const onExport = useCallback(async () => {
    setExporting(true); setExportError(null)
    try {
      const name = await reportsApi.exportCsv(EXPORT_TAB[filters.tab], filters)
      setToast(`Downloaded ${name}`)
    } catch {
      setExportError('The export failed. No file was created. Try again.')
    } finally {
      setExporting(false)
    }
  }, [filters])

  const dur = (prefersReducedMotion() ? MOTION.reducedMs : MOTION.crossfadeMs) / 1000
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Reports</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportTabs tabs={tabs} active={filters.tab} onChange={t => patch({ tab: t })} />
        <ReportActions compare={filters.compare} onCompare={c => patch({ compare: c })} {...(isFinance ? { onExport, exporting } : {})} />
      </div>
      <ReportFilterBar filters={filters} cities={cities} categories={categories} onChange={patch} />
      {exportError && <p role="alert" className="text-md text-danger">{exportError}</p>}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={filters.tab}
          role="tabpanel" id={`report-panel-${filters.tab}`} aria-labelledby={`report-tab-${filters.tab}`}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur, ease: MOTION.ease }}
        >
          {filters.tab === 'overview' && <OverviewTab ctx={ctx} />}
          {filters.tab === 'demand' && <DemandTab ctx={ctx} />}
          {filters.tab === 'drivers' && <DriversTab ctx={ctx} />}
          {filters.tab === 'finance' && isFinance && <FinanceTab ctx={ctx} />}
        </motion.div>
      </AnimatePresence>
      <SuccessToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

export default function AnalyticsPage() {
  return <Suspense fallback={null}><ReportsPage /></Suspense>
}
