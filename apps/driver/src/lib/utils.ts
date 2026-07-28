import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...args: ClassValue[]) => twMerge(clsx(args))

// Universal link — opens the native Google Maps app on iOS/Android if installed,
// falls back to the web app otherwise. No need for comgooglemaps://-style scheme sniffing.
export const openMapsNav = (lat: number, lng: number) =>
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, '_blank')
