// Next.js turns any uncaught script error into a full-screen "This page couldn't load". Google's own Maps script throws inside itself
// when its key is rejected, quota is out or a network blocks it, and on the public trip page the status, plate and route text must
// stay usable without the map. This listener runs in the capture phase and only swallows errors whose source file is Google's map
// script; every other error still reaches Next.js. Imported for its side effect, so it is installed when this page's code loads,
// before the Maps script is ever added (that happens later, in an effect). The map then shows "Map unavailable" (see TripMap).

export const isMapsScriptError = (filename: string | undefined): boolean => !!filename && /(maps\.googleapis\.com|maps\.gstatic\.com)/.test(filename)

const FLAG = '__ocarMapsErrorFilter'

export function installMapsErrorFilter(target: Window = window): void {
  const w = target as unknown as Record<string, unknown>
  if (w[FLAG]) return
  w[FLAG] = true
  target.addEventListener(
    'error',
    (e: ErrorEvent) => {
      if (isMapsScriptError(e.filename)) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }
    },
    true,
  )
}

if (typeof window !== 'undefined') installMapsErrorFilter()
