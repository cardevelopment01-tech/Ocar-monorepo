'use client'

import { usePathname, useRouter } from 'next/navigation'
import BottomNav from '@/components/ui/BottomNav'

type Tab = 'trip' | 'messages' | 'help' | 'profile'

// Flow pages own their full bottom chrome — no shared nav bar
const HIDE_NAV_PREFIXES = ['/search', '/select-ride', '/confirm-pickup', '/ride/', '/rental', '/round-trip']

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const showNav = !HIDE_NAV_PREFIXES.some(p => pathname.startsWith(p))

  const activeTab: Tab =
    pathname.startsWith('/history') ? 'trip'
    : pathname.startsWith('/home')  ? 'trip'
    : pathname.startsWith('/profile') ? 'profile'
    : 'trip'

  const handleTabChange = (tab: Tab) => {
    if (tab === 'trip') router.push('/home')
    if (tab === 'profile') router.push('/profile')
  }

  return (
    <div className="relative h-[100dvh] overflow-hidden">
      {children}
      {showNav && <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />}
    </div>
  )
}
