'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import OfferForm from '@/components/offers/OfferForm'
import { useOffersSetup } from '@/components/offers/useOffersSetup'
import { useAdminAuth } from '@/lib/auth-context'
import { offersApi } from '@/lib/offers-api'
import { TEMPLATES, emptyDraft, toPayload, type Draft } from '@/lib/offers-model'
import { extractErrorMessage } from '@/lib/http-errors'

export default function NewOfferPage() {
  const router = useRouter()
  const { admin } = useAdminAuth()
  const { meta, lookups, error: setupError, loading } = useOffersSetup()
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [chosen, setChosen] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const canWrite = admin?.role === 'super_admin' || admin?.role === 'ops_admin'

  async function save(publish: boolean) {
    setSubmitting(true)
    setError('')
    try {
      const offer = await offersApi.create(toPayload(draft, publish ? 'active' : 'draft'))
      router.push(`/offers/${offer.id}`)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save the offer.'))
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/offers" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary min-h-[44px]"><ArrowLeft size={14} /> All offers</Link>
      <h1 className="page-title">New offer</h1>

      {admin && !canWrite ? (
        <p role="alert" className="admin-card text-sm text-text-secondary">Your role can view offers but not create them.</p>
      ) : setupError ? (
        <p role="alert" className="admin-card text-sm text-danger">{setupError}</p>
      ) : loading || !meta ? (
        <p className="admin-card text-sm text-text-muted">Loading…</p>
      ) : (
        <>
          <section aria-labelledby="tpl" className="admin-card space-y-3">
            <h2 id="tpl" className="text-sm font-bold text-text-primary">Start from</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" aria-pressed={chosen === t.id}
                  onClick={() => { setChosen(t.id); setDraft(t.apply(emptyDraft())) }}
                  className={`text-left rounded-2xl border p-3 min-h-[72px] ${chosen === t.id ? 'border-primary bg-primary-light' : 'border-border bg-surface hover:bg-surface-2'}`}>
                  <span className="block text-sm font-semibold text-text-primary">{t.label}</span>
                  <span className="block text-xs text-text-muted mt-0.5">{t.hint}</span>
                </button>
              ))}
            </div>
          </section>
          <OfferForm meta={meta} draft={draft} onChange={setDraft} mode="create" lookups={lookups} submitting={submitting} error={error} onSave={(p) => void save(p)} />
        </>
      )}
    </div>
  )
}
