import { useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useUnreadSync, usePushEnable, usePushPrimer } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { socket } from '@/services/socket'
import { setupPushNotifications } from '@/services/notifications'
import { useAuthStore } from '@/store/useAuthStore'

const PRIMER_SNOOZE_KEY = 'ocar_push_primer_snoozed_at'

// Stable identities: usePushPrimer re-reads the snooze whenever `get` changes.
const snooze = {
  get: async () => {
    const raw = await AsyncStorage.getItem(PRIMER_SNOOZE_KEY)
    return raw ? Number(raw) : null
  },
  set: (ts: number) => AsyncStorage.setItem(PRIMER_SNOOZE_KEY, String(ts)),
}

// Root-mounted once. Silent on purpose (never shows the system dialog): re-registers the device
// token and its refresh listener on every launch while signed in -- previously this only ran at
// login, so after an app restart the token was never refreshed -- and keeps the unread badge live.
export function usePushRegistration(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  useEffect(() => {
    if (isAuthenticated) void setupPushNotifications()
  }, [isAuthenticated])
  useUnreadSync(api, socket, isAuthenticated)
}

// For any screen that offers "turn on notifications" (primer, banner, settings).
export function usePushEnableAction() {
  return usePushEnable(setupPushNotifications)
}

// Home screen: the explain-then-ask sheet.
export function useNotificationPrimer() {
  const push = usePushEnableAction()
  const primer = usePushPrimer(push, snooze)
  return primer
}
