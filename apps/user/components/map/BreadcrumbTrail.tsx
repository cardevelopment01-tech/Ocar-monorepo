'use client'

import { useMemo } from 'react'
import { Polyline } from '@vis.gl/react-google-maps'

interface BreadcrumbTrailProps {
  positions: [number, number][]
}

export default function BreadcrumbTrail({ positions }: BreadcrumbTrailProps) {
  const path = useMemo(
    () => positions.map(([lat, lng]) => ({ lat, lng })),
    [positions]
  )

  if (positions.length < 2) return null

  return (
    <Polyline
      path={path}
      strokeColor="#94A3B8"
      strokeWeight={3}
      strokeOpacity={0.55}
    />
  )
}
