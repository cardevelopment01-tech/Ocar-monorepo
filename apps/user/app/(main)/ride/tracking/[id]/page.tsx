'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// Redirect to the main ride page which handles all states
export default function TrackingRedirectPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(`/ride/${params.id}`)
  }, [router, params.id])
  return null
}
