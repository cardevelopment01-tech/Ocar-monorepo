'use client'
import { useCallback, useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { kycRemindersApi, type DriverState, type ReminderReport, type SendResult } from '@/lib/kyc-reminders-api'
import { RESULT_LABEL, STATE_LABEL, remindersText, stepLabel } from '@/lib/kyc-reminders-model'
import { relativeTime } from '@/lib/system-config-model'
import { cn } from '@/lib/utils'

const TONE = { success: 'pill-success', warning: 'pill-warning', danger: 'pill-danger', info: 'pill-info', muted: 'pill-muted' } as const

export default function DriverOnboardingPage() {
  const [report, setReport] = useState<ReminderReport | null>(null)
  const [state, setState] = useState<DriverState | ''>('')
  const [result, setResult] = useState<SendResult | ''>('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      setReport(await kycRemindersApi.report({ ...(state ? { state } : {}), ...(result ? { result } : {}) }))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [state, result])
  useEffect(() => { void load() }, [load])

  const s = report?.summary
  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text-primary">Onboarding follow-up</h1>
        <p className="text-sm text-text-muted">Drivers who stopped partway through verification, the reminders they were sent, and whether those reached their phone. Change the timing under System config &gt; Driver onboarding.</p>
      </div>

      {s ? (
        <div className="flex flex-wrap gap-2" aria-label="Summary">
          <span className="pill pill-muted">{s.stalled} stalled</span>
          <span className="pill pill-info">{s.reminded} reminded</span>
          <span className="pill pill-success">{s.cameBack} came back</span>
          <span className={cn('pill', s.notReached > 0 ? 'pill-warning' : 'pill-muted')}>{s.notReached} not reached</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-text-muted">State
          <select className="input h-9" value={state} onChange={(e) => setState(e.target.value as DriverState | '')}>
            <option value="">All</option>
            {(Object.keys(STATE_LABEL) as DriverState[]).map((k) => <option key={k} value={k}>{STATE_LABEL[k].label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-text-muted">Last result
          <select className="input h-9" value={result} onChange={(e) => setResult(e.target.value as SendResult | '')}>
            <option value="">All</option>
            {(['reached', 'no_device', 'blocked', 'problem'] as SendResult[]).map((k) => <option key={k} value={k}>{RESULT_LABEL[k].label}</option>)}
          </select>
        </label>
      </div>

      <section aria-label="Drivers" className="panel overflow-x-auto">
        {loading ? (
          <div aria-busy="true" className="m-3 h-40 animate-pulse rounded-lg bg-surface-2" />
        ) : failed ? (
          <div className="p-6 text-center text-sm">
            <p className="mb-3 text-text-muted">Couldn&apos;t load the report.</p>
            <button className="btn-primary" onClick={() => void load()}>Retry</button>
          </div>
        ) : !report || report.rows.length === 0 ? (
          <div className="p-8 text-center">
            <BellRing className="mx-auto mb-2 h-8 w-8 text-text-muted" aria-hidden />
            <p className="font-medium text-text-primary">No drivers match</p>
            <p className="text-sm text-text-muted">Drivers appear here once they have been stalled for a day or have been sent a reminder.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Driver</th><th>Stopped at</th><th>Last step done</th><th>Reminders</th><th>Last result</th><th>State</th></tr>
            </thead>
            <tbody>
              {report.rows.map((r) => {
                const res = r.sends.length > 0 ? RESULT_LABEL[r.sends[r.sends.length - 1]!.result] : null
                const st = STATE_LABEL[r.state]
                return (
                  <tr key={r.driverId}>
                    <td><span className="block font-medium text-text-primary">{r.name ?? r.phone}</span><span className="block text-xs text-text-muted">{r.phone}</span></td>
                    <td>{stepLabel(r.step)}</td>
                    <td>{relativeTime(r.lastProgressAt)}</td>
                    <td>{remindersText(r.sends)}</td>
                    <td>{res ? <span className={cn('pill', TONE[res.tone])}>{res.label}</span> : <span className="text-text-muted">Nothing sent</span>}</td>
                    <td><span className={cn('pill', TONE[st.tone])}>{st.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
