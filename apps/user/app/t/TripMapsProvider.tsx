'use client'

import '@/lib/trip-share/maps-error-filter'
import GoogleMapsProvider from '@/components/ui/GoogleMapsProvider'

// The shared Google Maps provider, with the error filter installed first (see maps-error-filter.ts).
export default function TripMapsProvider({ children }: { children: React.ReactNode }) {
  return <GoogleMapsProvider>{children}</GoogleMapsProvider>
}
