import { useRouter } from 'expo-router'
import { NotificationSettings } from '@ocar/mobile-shared'
import { usePushEnableAction } from '@/features/notifications/usePushSetup'

// Mirrors the Android channels created in services/notifications/index.ts.
const TOPICS = [
  { name: 'Ride requests', description: 'New ride offers sent to you while you are online.' },
  { name: 'Ride updates', description: 'Rides assigned to you, added stops, pickup changes and cancellations.' },
  { name: 'Messages', description: 'Messages from your rider during a trip.' },
  { name: 'Account alerts', description: 'Document reviews and expiry, wallet balance, warnings and suspensions.' },
]

export default function NotificationSettingsScreen() {
  const router = useRouter()
  const push = usePushEnableAction()
  return (
    <NotificationSettings
      topics={TOPICS}
      permission={{ state: push.state, canAskAgain: push.canAskAgain }}
      onEnablePush={() => { void push.enable() }}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
    />
  )
}
