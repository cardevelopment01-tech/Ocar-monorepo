export const EASE = [0.22, 1, 0.36, 1] as const

// The rider web app (apps/user) is the single hosted source for Terms &
// Privacy content -- every other surface (this app, admin, both mobile apps)
// links out to it instead of duplicating the legal text 5x. Override via
// VITE_LEGAL_BASE_URL per environment; falls back to the domain already
// assumed elsewhere in this app (see the old support@ocar.in mailto).
const LEGAL_BASE_URL = (import.meta.env['VITE_LEGAL_BASE_URL'] as string | undefined) || 'https://ocarindia.com'
export const TERMS_URL = `${LEGAL_BASE_URL}/legal/terms`
export const PRIVACY_URL = `${LEGAL_BASE_URL}/legal/privacy`

// Shared stacking scale so fixed/portaled overlays have a deterministic order
// instead of ad-hoc z-[N] values colliding (e.g. SOSButton vs BottomNav both
// at z-[100]). SOS sits above everything else in the app on purpose — a
// safety escalation must never lose a stacking fight with a checkout-style
// sheet (see docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 1).
export const Z_SOS_MODAL = 150

export const GLASS = {
  background:           'rgba(255,255,255,0.92)',
  backdropFilter:       'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border:               '1px solid rgba(10, 159, 176,0.10)',
  boxShadow:            '0 2px 16px rgba(10, 159, 176,0.10)',
}

export function fmtReturn(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const z = (n: number) => String(n).padStart(2, '0')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${mo[d.getMonth()]} · ${z(d.getHours())}:${z(d.getMinutes())}`
}
