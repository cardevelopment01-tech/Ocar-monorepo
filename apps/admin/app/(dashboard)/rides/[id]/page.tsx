'use client'
import { use } from 'react'
import RideDetail from '@/components/rides/RideDetail'

export default function RideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <RideDetail rideId={id} />
}
