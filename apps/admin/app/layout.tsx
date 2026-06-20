import type { Metadata } from 'next'

import { DM_Sans } from 'next/font/google'
import './globals.css'
import { AdminAuthProvider } from '@/lib/auth-context'

const dmSans = DM_Sans({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Ocar Admin',
  description: 'Ocar platform administration',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={dmSans.className}>
        <AdminAuthProvider>
          {children}
        </AdminAuthProvider>
      </body>
    </html>
  )
}
