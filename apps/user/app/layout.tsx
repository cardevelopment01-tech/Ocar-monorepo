import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google'

import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import { LocationProvider } from '@/lib/location-context'
import SplashWrapper from '@/components/ui/SplashWrapper'
import NotificationToast from '@/components/ui/NotificationToast'
import MaintenanceProvider from '@/components/providers/MaintenanceProvider'

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
  title: 'Ocar',
  description: 'Book a cab in seconds. Ocar is the fastest way to get a ride.',
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
        <main className="min-h-[100dvh] bg-background">
          <div className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative">
            <MaintenanceProvider>
              <LocationProvider>
                <AuthProvider>
                  <NotificationsProvider>
                    <SplashWrapper>{children}</SplashWrapper>
                    <NotificationToast />
                  </NotificationsProvider>
                </AuthProvider>
              </LocationProvider>
            </MaintenanceProvider>
          </div>
        </main>
      </body>
    </html>
  )
}
