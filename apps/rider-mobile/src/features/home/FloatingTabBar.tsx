import { FloatingTabBar as SharedTabBar, useNavBottom, useNavClearance, useUnreadCount, type TabDef } from '@ocar/mobile-shared'

export { useNavBottom, useNavClearance }

const TABS: TabDef[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'fleet', label: 'Fleet', icon: 'fleet' },
  { route: 'trips', label: 'Trips', icon: 'trips' },
  { route: 'profile', label: 'Account', icon: 'account' },
]

// Structural subset of react-navigation's BottomTabBarProps, all the shared bar reads.
type BarProps = Parameters<typeof SharedTabBar>[0] extends infer P ? Omit<P & object, 'tabs'> : never

export function FloatingTabBar(props: BarProps) {
  // Notifications live under Account (no bell on the map), so unread shows as a dot on that tab.
  const unread = useUnreadCount() > 0
  const tabs = unread ? TABS.map((t) => (t.route === 'profile' ? { ...t, badge: true } : t)) : TABS
  return <SharedTabBar {...props} tabs={tabs} />
}
