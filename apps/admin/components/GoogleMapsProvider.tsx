'use client'

import { APIProvider } from '@vis.gl/react-google-maps'

export default function GoogleMapsProvider({ children }: { children: React.ReactNode }) {
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!} libraries={['places']}>
      {children}
    </APIProvider>
  )
}
