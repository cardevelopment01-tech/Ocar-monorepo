import type { Metadata, Viewport } from 'next'

import './globals.css'
import { AuthProvider } from '@/lib/auth-context'

export const metadata: Metadata = {
  title: 'Ocar — Your ride, your way',
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
      <body>
        <main className="min-h-[100dvh] bg-background">
          <div className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative">
            <AuthProvider>{children}</AuthProvider>
          </div>
        </main>
      </body>
    </html>
  )
}
