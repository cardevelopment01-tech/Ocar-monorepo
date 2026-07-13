'use client'

import { useEffect, useRef, useState } from 'react'
import MapViewInner from '@/components/ui/MapViewInner'
import BreadcrumbTrail from './BreadcrumbTrail'
import FitBounds from './FitBounds'
import RecenterMap from './RecenterMap'
import LocationPin from './LocationPin'
import CarMarker from './CarMarker'
import RoutePolyline from './RoutePolyline'
import TrafficLayer from './TrafficLayer'

// Brief "here's the whole picture" beat when a driver first appears or the leg
// changes (pickup -> destination), then settles into a plain follow — mirrors
// the driver app's own overview/nav beat pattern (see
// apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx's mapMode). Without
// this the map stayed at its static initial zoom (13) for the entire trip,
// which is what made it look "zoomed way too out" (Customer#3).
const OVERVIEW_BEAT_MS = 1200

interface RideMapSceneProps {
  center: [number, number]
  pickupPos: [number, number]
  dropPos: [number, number]
  encodedPolyline?: string
  driverPos?: [number, number]
  driverHeading?: number
  driverHeadingKnown?: boolean
  routeMode: 'pickup-dest' | 'driver-pickup' | 'driver-dest' | 'recap'
  showDrop?: boolean
  breadcrumb?: [number, number][]
  userPos?: [number, number]
  nearbyDrivers?: Array<{ driver_id: string; lat: number; lng: number }>
  /** Route trimmed to what's still ahead of the driver's last snapped position —
   *  when present, rendered instead of the full route (see
   *  docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 7b). Falls back to the full
   *  `encodedPolyline` when absent (off-route, or before the first snap). */
  remainingPath?: [number, number][]
}

export default function RideMapScene({
  center,
  pickupPos,
  dropPos,
  encodedPolyline,
  driverPos,
  driverHeading = 0,
  driverHeadingKnown = true,
  routeMode,
  showDrop = true,
  breadcrumb,
  userPos,
  nearbyDrivers,
  remainingPath,
}: RideMapSceneProps) {
  const isRecap      = routeMode === 'recap'
  const isPickupLeg  = routeMode === 'driver-pickup'
  const isInProgress = routeMode === 'driver-dest'
  const isSearching  = routeMode === 'pickup-dest'
  const legTarget    = isPickupLeg ? pickupPos : dropPos

  // Re-arm the overview beat whenever the leg changes or a driver position
  // first becomes available for this leg.
  const beatKey = `${routeMode}:${driverPos ? '1' : '0'}`
  const [overview, setOverview] = useState(true)
  const prevBeatKey = useRef(beatKey)
  useEffect(() => {
    if (prevBeatKey.current === beatKey) return
    prevBeatKey.current = beatKey
    setOverview(true)
    const t = setTimeout(() => setOverview(false), OVERVIEW_BEAT_MS)
    return () => clearTimeout(t)
  }, [beatKey])

  return (
    <MapViewInner center={center} zoom={13}>
      {!isRecap && <TrafficLayer />}
      {isRecap
        ? (showDrop && <FitBounds positions={[pickupPos, dropPos]} paddingBottom={40} />)
        : driverPos
          ? (overview
              ? <FitBounds positions={[driverPos, legTarget]} paddingBottom={40} />
              // Map itself stays north-up here — CarMarker already rotates its own icon to
              // heading. Also rotating the map via RecenterMap's heading prop would double-
              // rotate (the exact bug the driver app's SelfCarMarker comment already warns
              // about), which is what made heading look like it was spinning indefinitely.
              : <RecenterMap center={driverPos} />)
          : (showDrop && <FitBounds positions={[pickupPos, dropPos]} paddingBottom={40} />)
      }
      <LocationPin position={pickupPos} variant="pickup" />
      {isPickupLeg && userPos && <LocationPin position={userPos} variant="user" />}
      {showDrop && <LocationPin position={dropPos} variant="drop" />}
      {isInProgress && breadcrumb && <BreadcrumbTrail positions={breadcrumb} />}
      {/* Static full-route backdrop, only while a driver is actually being followed
          (matches the trimming this backs) — see remainingPath's doc comment. */}
      {driverPos && !isRecap && <RoutePolyline encoded={encodedPolyline} variant="traveled-backdrop" />}
      <RoutePolyline
        encoded={remainingPath ? undefined : encodedPolyline}
        positions={remainingPath}
        variant={isPickupLeg ? 'pickup-leg' : 'default'}
      />
      {driverPos && !isRecap && (
        <CarMarker position={driverPos} heading={driverHeading} headingKnown={driverHeadingKnown} />
      )}
      {isSearching && !driverPos && nearbyDrivers?.map(d => (
        <CarMarker key={d.driver_id} position={[d.lat, d.lng]} />
      ))}
    </MapViewInner>
  )
}
