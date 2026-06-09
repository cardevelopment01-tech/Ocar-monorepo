import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// Incoming requests are now handled as an overlay on Home.tsx via Socket.io.
// This route is kept for backwards-compat but redirects home immediately.
export default function IncomingRequest() {
  const navigate = useNavigate()
  useEffect(() => { navigate('/', { replace: true }) }, [navigate])
  return null
}
