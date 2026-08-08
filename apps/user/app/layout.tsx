import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'

import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import { LocationProvider } from '@/lib/location-context'
import SplashWrapper from '@/components/ui/SplashWrapper'
import NotificationToast from '@/components/ui/NotificationToast'

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-inter',
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
    <html lang="en" className={inter.variable}>
      <body>
        <main className="min-h-[100dvh] bg-background">
          <div className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative">
            <LocationProvider>
              <AuthProvider>
                <NotificationsProvider>
                  <SplashWrapper>{children}</SplashWrapper>
                  <NotificationToast />
                </NotificationsProvider>
              </AuthProvider>
            </LocationProvider>
          </div>
        </main>
      </body>
    </html>
  )
}
