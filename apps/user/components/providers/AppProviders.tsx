'use client'

import { usePathname } from 'next/navigation'

import { AuthProvider } from '@/lib/auth-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import { LocationProvider } from '@/lib/location-context'
import SplashWrapper from '@/components/ui/SplashWrapper'
import NotificationToast from '@/components/ui/NotificationToast'
import CookieNotice from '@/components/ui/CookieNotice'
import MaintenanceProvider from '@/components/providers/MaintenanceProvider'

// The public marketing/policy site (what a payment-gateway reviewer or a first
// visitor sees) is a normal responsive website: no 430px phone shell, no splash,
// and no geolocation prompt or auth/socket providers spinning up on load. Only
// the actual ride app keeps the mobile shell.
const SITE_PATHS = ['/about', '/pricing', '/contact', '/legal']

export function isSitePath(pathname: string): boolean {
  return pathname === '/' || SITE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export default function AppProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (isSitePath(pathname)) return <>{children}</>

  return (
    <main className="min-h-[100dvh] bg-background">
      <div className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative">
        <MaintenanceProvider>
          <LocationProvider>
            <AuthProvider>
              <NotificationsProvider>
                <SplashWrapper>{children}</SplashWrapper>
                <NotificationToast />
                <CookieNotice />
              </NotificationsProvider>
            </AuthProvider>
          </LocationProvider>
        </MaintenanceProvider>
      </div>
    </main>
  )
}
