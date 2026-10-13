import { useRouter } from 'expo-router'
import { NotificationCenter } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { socket } from '@/services/socket'
import { resolvePushRoute } from '@/features/notifications/pushRouting'
import { usePushEnableAction } from '@/features/notifications/usePushSetup'

export default function NotificationsScreen() {
  const router = useRouter()
  const push = usePushEnableAction()
  return (
    <NotificationCenter
      api={api}
      socket={socket}
      resolveRoute={resolvePushRoute}
      onNavigate={(route) => router.push(route as never)}
      // Opened from a push on a cold start there is nothing to go back to.
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
      onOpenSettings={() => router.push('/notification-settings')}
      permission={{ state: push.state, canAskAgain: push.canAskAgain }}
      onEnablePush={() => { void push.enable() }}
    />
  )
}
