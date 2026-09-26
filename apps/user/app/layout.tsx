import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google'

import './globals.css'
import AppProviders from '@/components/providers/AppProviders'

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sans',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--font-display',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://ocarindia.com'),
  title: { default: 'Ocar | Intercity cabs in Odisha', template: '%s | Ocar' },
  description:
    'Ocar is an intercity cab booking platform for Bhubaneswar, Cuttack and Puri. Verified drivers, upfront fares and live trip tracking.',
  openGraph: { siteName: 'Ocar', type: 'website', locale: 'en_IN' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${spaceGrotesk.variable}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
