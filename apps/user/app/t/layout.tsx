import { Noto_Sans_Devanagari, Noto_Sans_Oriya } from 'next/font/google'

import TripMapsProvider from './TripMapsProvider'

// The brand fonts (Plus Jakarta Sans, Space Grotesk) have no Hindi or Odia letters, and Odia is poorly supported on many Android
// phones. These two are script fallbacks only: the browser downloads a font file when the page actually shows that script
// (unicode-range), so English viewers pay nothing. A justified exception to "no new font imports" (DESIGN.md).
const devanagari = Noto_Sans_Devanagari({ subsets: ['devanagari'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-deva', preload: false })
const oriya = Noto_Sans_Oriya({ subsets: ['oriya'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-orya', preload: false })

export default function TripShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${devanagari.variable} ${oriya.variable}`}>
      <TripMapsProvider>{children}</TripMapsProvider>
    </div>
  )
}
