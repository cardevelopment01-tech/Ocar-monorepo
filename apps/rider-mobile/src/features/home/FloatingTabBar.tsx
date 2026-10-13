import { FloatingTabBar as SharedTabBar, useNavBottom, useNavClearance, type TabDef } from '@ocar/mobile-shared'

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
  return <SharedTabBar {...props} tabs={TABS} />
}
