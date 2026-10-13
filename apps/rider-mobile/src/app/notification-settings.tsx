import { useRouter } from 'expo-router'
import { NotificationSettings } from '@ocar/mobile-shared'
import { usePushEnableAction } from '@/features/notifications/usePushSetup'

// Mirrors the Android channels created in services/notifications/index.ts.
const TOPICS = [
  { name: 'Ride updates', description: 'Driver on the way, arrived, trip started and completed, cancellations and payment problems.' },
  { name: 'Messages', description: 'Messages from your driver during a trip.' },
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
