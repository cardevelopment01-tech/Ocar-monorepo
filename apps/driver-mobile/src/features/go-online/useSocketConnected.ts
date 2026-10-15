import { useEffect, useState } from 'react'
import { socket } from '@/services/socket'

/** Live state of the realtime connection that delivers ride requests. False while it is down or reconnecting. */
export function useSocketConnected(): boolean {
  const [connected, setConnected] = useState(socket.connected)
  useEffect(() => {
    const up = () => setConnected(true)
    const down = () => setConnected(false)
    socket.on('connect', up)
    socket.on('disconnect', down)
    setConnected(socket.connected)
    return () => {
      socket.off('connect', up)
      socket.off('disconnect', down)
    }
  }, [])
  return connected
}
