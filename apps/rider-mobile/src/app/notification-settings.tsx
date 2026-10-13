import { useRouter } from 'expo-router'
import { NotificationSettings, useNotificationPreferences } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { usePushEnableAction } from '@/features/notifications/usePushSetup'

// Mirrors the Android channels created in services/notifications/index.ts.
const TOPICS = [
  { name: 'Ride updates', description: 'Driver on the way, arrived, trip started and completed, cancellations and payment problems.', icon: 'navigation', tone: 'ride' as const },
  { name: 'Messages', description: 'Messages from your driver during a trip.', icon: 'message-circle', tone: 'ride' as const },
]

export default function NotificationSettingsScreen() {
  const router = useRouter()
  const push = usePushEnableAction()
  const { prefs, set } = useNotificationPreferences(api)
  return (
    <NotificationSettings
      topics={TOPICS}
      {...(prefs ? { switches: [
        { label: 'Announcements', description: 'Notices from Ocar', icon: 'volume-2', tone: 'promo' as const, value: prefs.announcements, onChange: (v: boolean) => set('announcements', v) },
        { label: 'Offers', description: 'Discounts and promotions', icon: 'gift', tone: 'promo' as const, value: prefs.offers, onChange: (v: boolean) => set('offers', v) },
      ] } : {})}
      permission={{ state: push.state, canAskAgain: push.canAskAgain }}
      onEnablePush={() => { void push.enable() }}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
    />
  )
}
