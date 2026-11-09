import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { socket } from '@/services/socket'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { createConnectionBannerController, type ConnectionBannerKind, type ConnectionBannerController } from './connectionBannerController'

// Feeds the controller from what the app already knows: the socket (connected or not, retrying), whether the driver is online, and whether
// the app is in front. It adds no network calls and no native dependency. The socket is the right signal: it is exactly the channel ride
// requests arrive on, so "socket down" is "requests cannot reach you", whatever the cause (no signal, data off, airplane mode).
export function useConnectionBanner(): ConnectionBannerKind {
  const isOnline = useDriverSessionStore((s) => s.isOnline)
  const [kind, setKind] = useState<ConnectionBannerKind>('hidden')
  const ctl = useRef<ConnectionBannerController | null>(null)

  useEffect(() => {
    const c = createConnectionBannerController(setKind)
    ctl.current = c
    c.setConnected(socket.connected)
    const onConnect = () => c.setConnected(true)
    const onDisconnect = () => c.setConnected(false)
    const onAttempt = () => c.reconnectAttempt()
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onDisconnect)
    socket.io.on('reconnect_attempt', onAttempt)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onDisconnect)
      socket.io.off('reconnect_attempt', onAttempt)
      c.dispose()
      ctl.current = null
    }
  }, [])

  useEffect(() => {
    const apply = () => ctl.current?.setActive(isOnline && AppState.currentState === 'active')
    apply()
    const sub = AppState.addEventListener('change', apply)
    return () => sub.remove()
  }, [isOnline])

  return kind
}
