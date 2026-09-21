import { useEffect } from 'react'
import { socket } from '@/services/socket'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { stopBackgroundTracking } from '@/services/location/backgroundTask'

type NotificationPayload = { type?: string }

// Root-level listener, same place useRideRequestListener lives -- syncs the
// local online/offline toggle when the SERVER force-ends a session. The
// cleanup worker's stale-heartbeat sweep (api/src/jobs/workers/cleanup.worker.ts)
// pauses a driver from matching after 90s with no location ping, then fully
// logs the session off after 10 minutes and pushes a "You went offline"
// notification -- but nothing in this app ever listened for that. A driver
// whose background tracking silently died (app backgrounded, OS killed the
// task, Doze) kept seeing the toggle say "Online" indefinitely even after the
// server had already logged them out and stopped sending them any ride
// requests at all. This closes that gap: on the same event that triggers the
// push, sync local state immediately instead of relying on the driver to
// notice a system notification and manually reopen the app.
export function useSessionSyncListener(): void {
  const setOffline = useDriverSessionStore((s) => s.setOffline)

  useEffect(() => {
    function onNotification(payload: NotificationPayload) {
      if (payload.type !== 'session_ended_stale') return
      stopBackgroundTracking().catch(() => {})
      setOffline()
    }
    socket.on('notification:new', onNotification)
    return () => {
      socket.off('notification:new', onNotification)
    }
  }, [setOffline])
}
