import { useRouter } from 'expo-router'
import { NotificationSettings, useNotificationPreferences } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { usePushEnableAction } from '@/features/notifications/usePushSetup'

// Mirrors the Android channels created in services/notifications/index.ts.
const TOPICS = [
  { name: 'Ride updates', description: 'Driver on the way, arrived, trip started and completed, cancellations and payment problems.' },
  { name: 'Messages', description: 'Messages from your driver during a trip.' },
]

export default function NotificationSettingsScreen() {
  const router = useRouter()
  const push = usePushEnableAction()
  const { prefs, set } = useNotificationPreferences(api)
  return (
    <NotificationSettings
      topics={TOPICS}
      {...(prefs ? { switches: [
        { label: 'Announcements', description: 'Notices from Ocar', value: prefs.announcements, onChange: (v: boolean) => set('announcements', v) },
        { label: 'Offers', description: 'Discounts and promotions', value: prefs.offers, onChange: (v: boolean) => set('offers', v) },
      ] } : {})}
      permission={{ state: push.state, canAskAgain: push.canAskAgain }}
      onEnablePush={() => { void push.enable() }}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
    />
  )
}
