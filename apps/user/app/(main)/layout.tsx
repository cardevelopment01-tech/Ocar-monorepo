'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import BottomNav from '@/components/ui/BottomNav'
import { rideApi } from '@/lib/ride-api'

type Tab = 'trip' | 'messages' | 'help' | 'profile'

// Flow pages own their full bottom chrome — no shared nav bar
const HIDE_NAV_PREFIXES = ['/search', '/select-ride', '/confirm-pickup', '/ride/', '/rental', '/round-trip', '/saved-places', '/payment-methods', '/notifications', '/safety', '/help']

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  // On mount, if the user has an active ride but isn't on the tracking page,
  // redirect them there so a reload never loses mid-ride state.
  useEffect(() => {
    if (pathname.startsWith('/ride/')) return
    rideApi.getActiveRide().then(res => {
      if (res?.rideId) router.replace(`/ride/${res.rideId}`)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showNav = !HIDE_NAV_PREFIXES.some(p => pathname.startsWith(p))

  const activeTab: Tab =
    pathname.startsWith('/history') ? 'trip'
    : pathname.startsWith('/home')  ? 'trip'
    : pathname.startsWith('/profile') ? 'profile'
    : 'trip'

  const handleTabChange = (tab: Tab) => {
    if (tab === 'trip') router.push('/history')
    if (tab === 'profile') router.push('/profile')
  }

  return (
    <div className="relative h-[100dvh] overflow-hidden">
      {children}
      {showNav && <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />}
    </div>
  )
}
