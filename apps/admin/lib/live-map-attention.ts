import type { LiveMapAttention } from './admin-api'

// Things on the live map that are not drivers: an open SOS, a live ride a sweep flagged, a pickup nobody has taken.
export type AttentionKind = 'sos' | 'flagged' | 'request'

export interface AttentionItem {
  key: string
  kind: AttentionKind
  lat: number
  lng: number
  title: string
  detail: string
  /** When it started (alert raised, ride flagged, request made): shown as "x ago". */
  since: string
  href: string
  linkLabel: string
  /** Needs a person right now (an SOS nobody has acknowledged yet): drawn with a pulse. */
  urgent: boolean
}

export interface AttentionCounts { sos: number; flagged: number; requests: number }

const humanize = (s: string) => s.replace(/_/g, ' ')

// Items without a position cannot be drawn, so they are left out here and still counted by `attentionCounts`.
export function toAttentionItems(a: LiveMapAttention | null): AttentionItem[] {
  if (!a) return []
  const out: AttentionItem[] = []
  for (const s of a.sos) {
    if (s.lat == null || s.lng == null) continue
    const who = [s.rider_name && `rider ${s.rider_name}`, s.driver_name && `driver ${s.driver_name}`].filter(Boolean).join(' · ')
    out.push({
      key: `sos:${s.id}`, kind: 'sos', lat: s.lat, lng: s.lng, since: s.created_at, urgent: s.status === 'triggered',
      title: `SOS · ${s.severity}`, detail: `${humanize(s.status)} · ride ${s.ride_id}${who ? ` · ${who}` : ''}`,
      href: '/sos', linkLabel: 'Open SOS console',
    })
  }
  for (const f of a.flagged) {
    if (f.lat == null || f.lng == null) continue
    out.push({
      key: `flagged:${f.ride_id}`, kind: 'flagged', lat: f.lat, lng: f.lng, since: f.flagged_at, urgent: false,
      title: 'Ride flagged for review', detail: `ride ${f.ride_id}${f.driver_name ? ` · ${f.driver_name}` : ''}${f.reason ? ` · ${humanize(f.reason)}` : ''}`,
      href: `/rides/${f.ride_id}`, linkLabel: 'Open ride',
    })
  }
  for (const r of a.requests) {
    if (r.lat == null || r.lng == null) continue
    out.push({
      key: `request:${r.ride_id}`, kind: 'request', lat: r.lat, lng: r.lng, since: r.created_at, urgent: false,
      title: r.kind === 'searching' ? 'Waiting for a driver' : 'No driver found',
      detail: `ride ${r.ride_id}${r.address ? ` · ${r.address}` : ''}`,
      href: `/rides/${r.ride_id}`, linkLabel: 'Open ride',
    })
  }
  return out
}

export function attentionCounts(a: LiveMapAttention | null): AttentionCounts {
  return { sos: a?.sos.length ?? 0, flagged: a?.flagged.length ?? 0, requests: a?.requests.length ?? 0 }
}

export const ATTENTION_LAYERS: Array<{ kind: AttentionKind; label: string; count: keyof AttentionCounts }> = [
  { kind: 'sos', label: 'SOS', count: 'sos' },
  { kind: 'flagged', label: 'Flagged', count: 'flagged' },
  { kind: 'request', label: 'Unmet requests', count: 'requests' },
]
