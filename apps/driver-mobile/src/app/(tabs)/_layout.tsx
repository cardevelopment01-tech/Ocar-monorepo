import { Redirect, Tabs } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { colors } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'

// tabBarIcon was never set on any of these three tabs -- the bar rendered
// labels only, no icons at all (not a broken font, nothing was ever asked
// for). Icon choices match the web driver app's BottomNav.tsx (Map/
// TrendingUp/User; its fourth tab, Wallet, isn't a separate mobile tab --
// it's reachable from Profile instead, see that screen's Account section).
export default function TabsLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Redirect href="/(auth)/phone" />

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
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Feather name="map" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="earnings"
        options={{ title: 'Earnings', tabBarIcon: ({ color, size }) => <Feather name="trending-up" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} /> }}
      />
    </Tabs>
  )
}
