'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { broadcastApi, type BroadcastAudience, type BroadcastCategory } from '@/lib/broadcast-api'

const AUDIENCES: { key: string; label: string; audience: BroadcastAudience }[] = [
  { key: 'drivers', label: 'All active drivers', audience: { role: 'driver' } },
  { key: 'riders', label: 'All active riders', audience: { role: 'rider' } },
  { key: 'rc', label: 'Drivers missing the RC back', audience: { role: 'driver', missingRcBack: true } },
]

export default function BroadcastsPage() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<BroadcastCategory>('announcement')
  const [audienceKey, setAudienceKey] = useState('drivers')
  const [preview, setPreview] = useState<{ recipientCount: number; sendableNow: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const audience = AUDIENCES.find(a => a.key === audienceKey)!.audience
  const ready = title.trim().length > 0 && body.trim().length > 0

  // Anything that changes who gets it invalidates the count the admin confirmed against.
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null); setSent(null); setError(null) }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch { setError('Request failed. Check the fields and try again.') } finally { setBusy(false) }
  }

  const checkAudience = () => run(async () => setPreview(await broadcastApi.preview(category, audience)))

  const send = () => run(async () => {
    const res = await broadcastApi.send({ title: title.trim(), body: body.trim(), category, audience })
    setSent(`Sending to ${res.recipientCount} people.`)
    setPreview(null); setTitle(''); setBody('')
  })

  return (
    <div className="admin-card max-w-xl space-y-4 p-5">
      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Send to</label>
        <select
          value={audienceKey}
          onChange={e => change(setAudienceKey)(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
        >
          {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Type</label>
        <select
          value={category}
          onChange={e => change(setCategory)(e.target.value as BroadcastCategory)}
          className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
        >
          <option value="announcement">Announcement (notice, any time)</option>
          <option value="offer">Offer (promotion, 10:00-21:00 IST only)</option>
        </select>
        <p className="text-[11px] text-text-muted mt-1">People who switched this type off in the app are skipped.</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Title ({title.length}/80)</label>
        <input
          value={title}
          maxLength={80}
          onChange={e => change(setTitle)(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Message ({body.length}/300)</label>
        <textarea
          value={body}
          rows={3}
          maxLength={300}
          onChange={e => change(setBody)(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
        />
      </div>

      {error && <p className="text-xs text-error">{error}</p>}
      {sent && <p className="text-xs text-success">{sent}</p>}
      {preview && !preview.sendableNow && (
        <p className="text-xs text-error">Offers can only be sent between 10:00 and 21:00 IST.</p>
      )}

      {preview ? (
        <div className="flex items-center gap-3">
          <button
            onClick={() => void send()}
            disabled={busy || !ready || preview.recipientCount === 0 || !preview.sendableNow}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Send size={14} /> Send to {preview.recipientCount} {preview.recipientCount === 1 ? 'person' : 'people'}
          </button>
          <span className="text-[11px] text-text-muted">This cannot be undone.</span>
        </div>
      ) : (
        <button onClick={() => void checkAudience()} disabled={busy || !ready} className="btn-secondary disabled:opacity-50">
          Check audience
        </button>
      )}
    </div>
  )
}
