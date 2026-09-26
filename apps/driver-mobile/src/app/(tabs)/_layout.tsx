import { Redirect, Tabs } from 'expo-router'
import { FloatingTabBar, type TabDef } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'

export default function TabsLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  // Fetched once here so the Profile badge is visible on every tab, not only on Home.
  const documentGate = useDocumentGate()
  if (!isAuthenticated) return <Redirect href="/(auth)/phone" />

  // Wallet is not a separate tab; it is reachable from the Account section of Profile.
  const TABS: TabDef[] = [
    { route: 'home', label: 'Home', icon: 'map' },
    { route: 'earnings', label: 'Earnings', icon: 'earnings' },
    { route: 'profile', label: 'Profile', icon: 'account', badge: documentGate.hasRejected },
  ]

  // Same floating pill bar as the rider app (one system across both apps); it floats over the screens, so
  // each tab pads its scroll content / docks its sheet using useNavClearance / useNavBottom.
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} tabs={TABS} />}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  )
}
