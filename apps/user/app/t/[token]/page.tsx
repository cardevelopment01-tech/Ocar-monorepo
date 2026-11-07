import type { Metadata } from 'next'

import TripShareView from '@/components/trip-share/TripShareView'

// A link someone was sent in confidence: never indexed, never leaks the address in a Referer header, and the preview a chat app
// builds says nothing about who or where (no names, no places). The referrer is the bare origin (no path, so no token): Google Maps
// keys are normally restricted by website, and with no Referer at all the map would be refused in production.
export const metadata: Metadata = {
  title: 'Live trip | Ocar',
  description: 'Follow a trip live on Ocar.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'strict-origin',
  openGraph: { title: 'Live trip on Ocar', description: 'Follow a trip live on Ocar.', siteName: 'Ocar', type: 'website' },
}

export default function TripSharePage() {
  return <TripShareView />
}
