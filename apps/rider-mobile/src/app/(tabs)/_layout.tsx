import { useEffect } from 'react'
import { Redirect, Tabs, useRouter } from 'expo-router'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { colors } from '@ocar/mobile-shared'
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

  // tabBarIcon was never set on any of these three tabs -- the bar rendered
  // labels only, no icons at all. Icon choices match the web user app's
  // BottomNav.tsx (Home/Car/User).
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.ink400,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Feather name="home" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="trips"
        options={{ title: 'My Trips', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="car" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} /> }}
      />
    </Tabs>
  )
}
