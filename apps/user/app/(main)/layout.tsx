'use client'

import { usePathname, useRouter } from 'next/navigation'
import BottomNav from '@/components/ui/BottomNav'

type Tab = 'trip' | 'messages' | 'help' | 'profile'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const activeTab: Tab =
    pathname.startsWith('/history') || pathname.startsWith('/ride') || pathname.startsWith('/home') || pathname.startsWith('/search') || pathname.startsWith('/select-ride')
      ? 'trip'
      : pathname.startsWith('/profile')
      ? 'profile'
      : 'trip'

  const handleTabChange = (tab: Tab) => {
    if (tab === 'trip') router.push('/home')
    if (tab === 'profile') router.push('/profile')
  }

  return (
    <div className="relative h-screen overflow-hidden">
      {children}
      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  )
}
