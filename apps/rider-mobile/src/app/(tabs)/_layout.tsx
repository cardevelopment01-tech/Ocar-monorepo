import { useEffect } from 'react'
import { Redirect, Tabs, useRouter } from 'expo-router'
import { useAuthStore } from '@/store/useAuthStore'
import { fetchActiveRideId } from '@/features/ride-tracking/api'

export default function TabsLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const router = useRouter()

  // Crash/relaunch recovery: a rider who force-closes mid-ride has no other way back
  // into it (push deep-linking is Days 13-14) -- check once on tab-entry mount and
  // redirect into the ride screen rather than stranding them on a static home tab.
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    fetchActiveRideId().then((rideId) => {
      if (!cancelled && rideId) router.replace(`/ride/${rideId}`)
    })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, router])

  if (!isAuthenticated) return <Redirect href="/(auth)/phone" />

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="trips" options={{ title: 'My Trips' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  )
}
