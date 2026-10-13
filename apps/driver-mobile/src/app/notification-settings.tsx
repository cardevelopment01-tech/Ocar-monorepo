import { useRouter } from 'expo-router'
import { NotificationSettings, useNotificationPreferences } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { usePushEnableAction } from '@/features/notifications/usePushSetup'

// Mirrors the Android channels created in services/notifications/index.ts.
const TOPICS = [
  { name: 'Ride requests', description: 'New ride offers sent to you while you are online.', icon: 'bell', tone: 'ride' as const },
  { name: 'Ride updates', description: 'Rides assigned to you, added stops, pickup changes and cancellations.', icon: 'navigation', tone: 'ride' as const },
  { name: 'Messages', description: 'Messages from your rider during a trip.', icon: 'message-circle', tone: 'ride' as const },
  { name: 'Announcements', description: 'Notices from Ocar, if you have not switched them off.', icon: 'volume-2', tone: 'promo' as const },
  { name: 'Account alerts', description: 'Document reviews and expiry, wallet balance, warnings and suspensions.', icon: 'shield', tone: 'account' as const },
]

export default function NotificationSettingsScreen() {
  const router = useRouter()
  const push = usePushEnableAction()
  const { prefs, set } = useNotificationPreferences(api)
  return (
    <NotificationSettings
      topics={TOPICS}
      {...(prefs ? { switches: [{ label: 'Announcements', description: 'Notices from Ocar', icon: 'volume-2', tone: 'promo' as const, value: prefs.announcements, onChange: (v: boolean) => set('announcements', v) }] } : {})}
      permission={{ state: push.state, canAskAgain: push.canAskAgain }}
      onEnablePush={() => { void push.enable() }}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
    />
  )
}
