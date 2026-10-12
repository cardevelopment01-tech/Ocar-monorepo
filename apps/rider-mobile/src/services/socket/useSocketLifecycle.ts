import { useEffect } from 'react'
import { AppState } from 'react-native'
import { useAuthStore } from '@/store/useAuthStore'
import { connectSocket, disconnectSocket } from './index'

// The socket only serves the screen in front of the rider (live driver position, status events).
// While the app is backgrounded it just burned radio wake-ups on a link Doze would kill anyway,
// and ride-status changes reach a backgrounded rider through FCM push. So: drop it on background,
// reconnect on foreground. Screens that track a ride re-join their room and refetch on every
// 'connect' (useRoomJoin), which also covers anything missed while away.
export function useSocketLifecycle(): void {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') disconnectSocket()
      else if (state === 'active' && useAuthStore.getState().isAuthenticated) connectSocket()
    })
    return () => sub.remove()
  }, [])
}
