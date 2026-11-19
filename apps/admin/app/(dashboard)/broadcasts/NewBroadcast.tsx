'use client'

import { useEffect, useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { BROADCAST_LINKS, broadcastApi, type AudiencePreview, type BroadcastCategory } from '@/lib/broadcast-api'
import { cityApi, type AdminCity } from '@/lib/city-api'
import { vehicleCategoryApi, type VehicleCategory } from '@/lib/vehicle-api'
import { extractErrorMessage } from '@/lib/http-errors'
import { cn } from '@/lib/utils'
import { EMPTY_FORM, MAX_PHONES, audienceReady, buildAudience, parsePhones, type AudienceForm } from './audience'

// Sending to more people than this asks "are you sure" first. A test to a few phone numbers goes straight through.
const CONFIRM_ABOVE = 10

const INPUT = 'w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors'
const LABEL = 'block text-xs font-semibold text-text-secondary mb-1.5'

export default function NewBroadcast({ onSent }: { onSent: () => void }) {
  const [form, setForm] = useState<AudienceForm>(EMPTY_FORM)
  const [category, setCategory] = useState<BroadcastCategory>('announcement')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [link, setLink] = useState('')
  const [imageBroken, setImageBroken] = useState(false)
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cities, setCities] = useState<AdminCity[]>([])
  const [categories, setCategories] = useState<VehicleCategory[]>([])

  useEffect(() => {
    cityApi.list().then(setCities).catch(() => {})
    vehicleCategoryApi.list().then(setCategories).catch(() => {})
  }, [])

  const cityOptions = useMemo(() => cities.map((c) => ({ value: String(c.id), label: c.name })), [cities])
  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: c.display_name })), [categories])

  const phones = useMemo(() => parsePhones(form.phonesText), [form.phonesText])
  const textReady = title.trim().length > 0 && body.trim().length > 0
  const targetReady = audienceReady(form)
  const image = imageUrl.trim()
  // Firebase refuses a message whose picture is not an https link, so the form holds the same line the server does.
  const imageInvalid = image !== '' && !/^https:\/\/\S+$/i.test(image)
  const links = BROADCAST_LINKS[form.role]
  const linkLabel = links.find((l) => l.value === link)?.label ?? null
  const who = form.role === 'driver' ? 'driver' : 'rider'

  // Anything that changes who gets it, or what it says, invalidates the numbers the admin checked against.
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null); setSent(null); setError(null) }
  const patch = (p: Partial<AudienceForm>) => { setForm((f) => ({ ...f, ...p })); setPreview(null); setSent(null); setError(null) }
  const changeImage = (v: string) => { setImageUrl(v); setImageBroken(false); setPreview(null); setSent(null); setError(null) }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (err) { setError(extractErrorMessage(err, 'Request failed. Check the fields and try again.')) } finally { setBusy(false) }
  }

  const checkAudience = () => run(async () => setPreview(await broadcastApi.preview(category, buildAudience(form))))

  const send = () => run(async () => {
    const res = await broadcastApi.send({
      title: title.trim(), body: body.trim(), category, audience: buildAudience(form),
      ...(image ? { imageUrl: image } : {}), ...(link ? { link } : {}),
    })
    setSent(`Sending to ${res.recipientCount} ${res.recipientCount === 1 ? 'person' : 'people'}. Follow it in Sent broadcasts.`)
    setPreview(null); setTitle(''); setBody(''); setImageUrl(''); setLink('')
    onSent()
  })

  const onSendClick = () => { if (preview && preview.recipientCount > CONFIRM_ABOVE) setConfirmOpen(true); else void send() }

  return (
    <div className="admin-card space-y-4 p-5 w-full max-w-2xl">
      <div>
        <p className="text-sm font-semibold text-text-primary">New broadcast</p>
        <p className="text-xs text-text-muted mt-0.5">A push notification. Drivers also get a copy in their notification list.</p>
      </div>

      <div>
        <label className={LABEL}>Send to</label>
        <div className="inline-flex rounded-xl border border-border p-0.5 bg-surface-2" role="group" aria-label="Send to">
          {(['driver', 'rider'] as const).map((r) => (
            <button
              key={r} type="button" aria-pressed={form.role === r}
              onClick={() => { patch({ ...EMPTY_FORM, role: r }); setLink('') }}
              className={cn('px-4 py-1.5 text-sm rounded-lg transition-colors', form.role === r ? 'bg-surface text-text-primary font-semibold shadow-sm' : 'text-text-muted hover:text-text-primary')}
            >
              {r === 'driver' ? 'Drivers' : 'Riders'}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-text-primary cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={form.usePhones} onChange={(e) => patch({ usePhones: e.target.checked })} />
        <span>
          Specific phone numbers only
          <span className="block text-[11px] text-text-muted">For a test to yourself or a reminder to one person. Not counted against the daily limit.</span>
        </span>
      </label>

      {form.usePhones ? (
        <div>
          <label htmlFor="bc-phones" className={LABEL}>Phone numbers (up to {MAX_PHONES}, one per line)</label>
          <textarea
            id="bc-phones" value={form.phonesText} rows={3} placeholder={'98610 03979\n+91 80936 30642'}
            onChange={(e) => patch({ phonesText: e.target.value })} className={INPUT}
          />
          <p className={cn('text-[11px] mt-1', phones.invalid.length || phones.valid.length > MAX_PHONES ? 'text-error' : 'text-text-muted')}>
            {phones.valid.length} valid {phones.valid.length === 1 ? 'number' : 'numbers'}
            {phones.invalid.length > 0 ? ` · not valid: ${phones.invalid.join(', ')}` : ''}
            {phones.valid.length > MAX_PHONES ? ` · too many (max ${MAX_PHONES})` : ''}
          </p>
        </div>
      ) : form.role === 'driver' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <MultiSelectFilter label="City" options={cityOptions} selected={form.cityIds} searchable searchPlaceholder="Search cities…" onChange={(v) => patch({ cityIds: v })} />
            <MultiSelectFilter label="Vehicle type" options={categoryOptions} selected={form.categoryIds} onChange={(v) => patch({ categoryIds: v })} />
          </div>
          <label className="flex items-start gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={form.docIssues} onChange={(e) => patch({ docIssues: e.target.checked })} />
            <span>
              Only drivers blocked by a document
              <span className="block text-[11px] text-text-muted">Expired, rejected, waiting for review, or RC back missing.</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" checked={form.missingRcBack} onChange={(e) => patch({ missingRcBack: e.target.checked })} />
            Only drivers missing the RC back
          </label>
        </div>
      ) : (
        <div>
          <label htmlFor="bc-booked" className={LABEL}>Riders</label>
          <select id="bc-booked" value={form.bookedInLastDays} onChange={(e) => patch({ bookedInLastDays: e.target.value as AudienceForm['bookedInLastDays'] })} className={INPUT}>
            <option value="">All active riders</option>
            <option value="7">Booked in the last 7 days</option>
            <option value="30">Booked in the last 30 days</option>
            <option value="90">Booked in the last 90 days</option>
          </select>
        </div>
      )}

      <div>
        <label htmlFor="bc-type" className={LABEL}>Type</label>
        <select id="bc-type" value={category} onChange={(e) => change(setCategory)(e.target.value as BroadcastCategory)} className={INPUT}>
          <option value="announcement">Announcement (notice, any time)</option>
          <option value="offer">Offer (promotion, 10:00-21:00 IST only)</option>
        </select>
        <p className="text-[11px] text-text-muted mt-1">People who switched this type off in the app are skipped.</p>
      </div>

      <div>
        <label htmlFor="bc-title" className={LABEL}>Title ({title.length}/80)</label>
        <input id="bc-title" value={title} maxLength={80} onChange={(e) => change(setTitle)(e.target.value)} className={INPUT} />
      </div>

      <div>
        <label htmlFor="bc-body" className={LABEL}>Message ({body.length}/300)</label>
        <textarea id="bc-body" value={body} rows={3} maxLength={300} onChange={(e) => change(setBody)(e.target.value)} className={INPUT} />
      </div>

      <div>
        <label htmlFor="bc-image" className={LABEL}>Picture (optional, https link)</label>
        <input
          id="bc-image" value={imageUrl} inputMode="url" placeholder="https://…/offer.jpg"
          onChange={(e) => changeImage(e.target.value)} className={cn(INPUT, imageInvalid && 'border-error')}
        />
        <p className={cn('text-[11px] mt-1', imageInvalid || imageBroken ? 'text-error' : 'text-text-muted')}>
          {imageInvalid
            ? 'The link must start with https://'
            : imageBroken
              ? 'This picture could not be loaded. Check the link opens in a browser.'
              : 'Shown large in the notification on Android. A wide picture (2:1) under 1 MB works best.'}
        </p>
      </div>

      <div>
        <label htmlFor="bc-link" className={LABEL}>When they tap it (optional)</label>
        <select id="bc-link" value={link} onChange={(e) => change(setLink)(e.target.value)} className={INPUT}>
          <option value="">Just open the app</option>
          {links.map((l) => <option key={l.value} value={l.value}>Open {l.label}</option>)}
        </select>
      </div>

      {(title.trim() || body.trim()) && (
        <div aria-label="How it looks on a phone" className="rounded-2xl border border-border bg-surface-2 p-3 max-w-sm space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Ocar · now</p>
          <div>
            <p className="text-sm font-semibold text-text-primary break-words">{title.trim() || 'Title'}</p>
            <p className="text-xs text-text-secondary mt-0.5 break-words whitespace-pre-line">{body.trim() || 'Message'}</p>
          </div>
          {image && !imageInvalid && !imageBroken && (
            // A plain <img>: the picture lives on whatever host the admin pasted, which next/image would need configured.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" onError={() => setImageBroken(true)} className="w-full aspect-[2/1] object-cover rounded-xl border border-border" />
          )}
          {linkLabel && <p className="text-[11px] text-text-muted">Tap opens: <span className="font-semibold text-text-primary">{linkLabel}</span></p>}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-error">{error}</p>}
      {sent && <p role="status" className="text-xs text-success">{sent}</p>}

      {preview && (
        <div aria-label="Audience check" className="rounded-xl border border-border bg-surface-2 p-4 space-y-2 text-sm">
          <p className="font-semibold text-text-primary">
            {preview.recipientCount} {preview.recipientCount === 1 ? who : `${who}s`} will be notified
          </p>
          <ul className="text-xs text-text-secondary space-y-1">
            <li><span className="font-semibold text-text-primary">{preview.withDevice}</span> also get the push on their phone (phone seen in the last 30 days)</li>
            <li><span className="font-semibold text-text-primary">{preview.inAppOnly}</span> get the in-app notification only (no recent phone registered)</li>
            {preview.skippedOptedOut > 0 && <li>{preview.skippedOptedOut} left out: switched this type off in the app</li>}
            {preview.skippedCapped > 0 && <li>{preview.skippedCapped} left out: already got {preview.dailyCap} broadcasts in the last 24 hours</li>}
            {preview.phonesNotFound.length > 0 && <li className="text-error">No active {who} account for: {preview.phonesNotFound.join(', ')}</li>}
          </ul>
          {preview.people.length > 0 && (
            <div className="text-xs">
              <p className="font-semibold text-text-primary">Going to</p>
              <ul className="text-text-secondary space-y-0.5">
                {preview.people.map((p) => (
                  <li key={p.phone}>{p.name?.trim() || 'No name on file'}{p.code ? ` (${p.code})` : ''} · {p.phone}</li>
                ))}
              </ul>
            </div>
          )}
          {form.role === 'rider' && preview.inAppOnly > 0 && (
            <p className="text-[11px] text-warning">
              Riders only receive this as a push. Those without a recent phone registration will not see it.
            </p>
          )}
          {!preview.sendableNow && <p className="text-xs text-error">Offers can only be sent between 10:00 and 21:00 IST.</p>}
        </div>
      )}

      {preview ? (
        <div className="flex items-center gap-3">
          <button
            onClick={onSendClick}
            disabled={busy || !textReady || imageInvalid || preview.recipientCount === 0 || !preview.sendableNow}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Send size={14} /> Send to {preview.recipientCount} {preview.recipientCount === 1 ? 'person' : 'people'}
          </button>
          <span className="text-[11px] text-text-muted">This cannot be undone.</span>
        </div>
      ) : (
        <button onClick={() => void checkAudience()} disabled={busy || !textReady || !targetReady || imageInvalid} className="btn-secondary disabled:opacity-50">
          Check audience
        </button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Send to ${preview?.recipientCount ?? 0} ${who}s?`}
        description={`"${title.trim()}" goes out right away and cannot be recalled.`}
        confirmLabel="Send now"
        variant="warning"
        onConfirm={() => { setConfirmOpen(false); void send() }}
      />
    </div>
  )
}
