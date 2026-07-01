export const EASE = [0.22, 1, 0.36, 1] as const

export const GLASS = {
  background:           'rgba(255,255,255,0.92)',
  backdropFilter:       'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border:               '1px solid rgba(79,70,229,0.10)',
  boxShadow:            '0 2px 16px rgba(79,70,229,0.10)',
}

export function fmtReturn(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const z = (n: number) => String(n).padStart(2, '0')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${mo[d.getMonth()]} · ${z(d.getHours())}:${z(d.getMinutes())}`
}
