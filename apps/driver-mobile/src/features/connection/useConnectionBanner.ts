import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { socket } from '@/services/socket'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { createConnectionBannerController, type ConnectionBannerKind, type ConnectionBannerController } from './connectionBannerController'

// Feeds the controller from what the app already knows: the socket (connected or not, retrying), whether the driver is online, and whether
// the app is in front. It adds no network calls and no native dependency. The socket is the right signal: it is exactly the channel ride
// requests arrive on, so "socket down" is "requests cannot reach you", whatever the cause (no signal, data off, airplane mode).
const STARTUP_GRACE_MS = 10_000

export function useConnectionBanner(): ConnectionBannerKind {
  const isOnline = useDriverSessionStore((s) => s.isOnline)
  const [kind, setKind] = useState<ConnectionBannerKind>('hidden')
  const ctl = useRef<ConnectionBannerController | null>(null)

  useEffect(() => {
    const c = createConnectionBannerController(setKind)
    ctl.current = c
    // On a cold start the socket has not connected yet: that is "starting", not "lost", so a socket that has never connected is only reported
    // as down after a longer grace (a slow network or a token refresh would otherwise flash a false warning).
    let everConnected = socket.connected
    let startupTimer: ReturnType<typeof setTimeout> | undefined
    const reportDown = () => {
      if (everConnected) { c.setConnected(false); return }
      if (startupTimer === undefined) startupTimer = setTimeout(() => c.setConnected(false), STARTUP_GRACE_MS)
    }
    c.setConnected(true)
    if (!socket.connected) reportDown()
    const onConnect = () => { everConnected = true; clearTimeout(startupTimer); startupTimer = undefined; c.setConnected(true) }
    // `io client disconnect` is the app closing the socket on purpose (going offline, logging out): nothing to warn about.
    const onDisconnect = (reason?: string) => { if (reason === 'io client disconnect') return; reportDown() }
    const onError = () => reportDown()
    const onAttempt = () => c.reconnectAttempt()
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onError)
    socket.io.on('reconnect_attempt', onAttempt)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onError)
      socket.io.off('reconnect_attempt', onAttempt)
      clearTimeout(startupTimer)
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
