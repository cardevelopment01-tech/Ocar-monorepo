import type { Metadata } from 'next'

import { DM_Sans } from 'next/font/google'
import './globals.css'
import { AdminAuthProvider } from '@/lib/auth-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import GoogleMapsProvider from '@/components/GoogleMapsProvider'
import MaintenanceBanner from '@/components/layout/MaintenanceBanner'

const dmSans = DM_Sans({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Ocar Admin',
  description: 'Ocar platform administration',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={dmSans.className}>
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
