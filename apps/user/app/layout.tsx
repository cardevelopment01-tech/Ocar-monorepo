import type { Metadata, Viewport } from 'next'

import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import SplashWrapper from '@/components/ui/SplashWrapper'
import GoogleMapsProvider from '@/components/ui/GoogleMapsProvider'
import NotificationToast from '@/components/ui/NotificationToast'

export const metadata: Metadata = {
  title: 'Ocar',
  description: 'Book a cab in seconds. Ocar is the fastest way to get a ride.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://maps.googleapis.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://maps.googleapis.com" />
      </head>
      <body>
        <main className="min-h-[100dvh] bg-background">
          <div className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative">
            <GoogleMapsProvider>
              <AuthProvider>
                <NotificationsProvider>
                  <SplashWrapper>{children}</SplashWrapper>
                  <NotificationToast />
                </NotificationsProvider>
              </AuthProvider>
            </GoogleMapsProvider>
          </div>
        </main>
      </body>
    </html>
  )
}
