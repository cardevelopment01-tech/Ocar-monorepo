import type { Metadata } from 'next'

import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { AdminAuthProvider } from '@/lib/auth-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import GoogleMapsProvider from '@/components/GoogleMapsProvider'
import MaintenanceBanner from '@/components/layout/MaintenanceBanner'

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
  title: 'Ocar Admin',
  description: 'Ocar platform administration',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans">
        <MaintenanceBanner />
        <GoogleMapsProvider>
          <AdminAuthProvider>
            <NotificationsProvider>
              {children}
            </NotificationsProvider>
          </AdminAuthProvider>
        </GoogleMapsProvider>
      </body>
    </html>
  )
}
