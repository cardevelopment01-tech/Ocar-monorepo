'use client'

import { memo } from 'react'
import { AdvancedMarker } from '@vis.gl/react-google-maps'

// Numbered waypoint pin — the map counterpart of RouteTimeline's violet stop
// chip. The number matches the chip so map and itinerary read as one trip
// (docs/MULTI_STOP_UI_REDESIGN_PLAN.md §4).
interface StopPinProps {
  position: [number, number]
  index: number
}

function StopPin({ position, index }: StopPinProps) {
  return (
    <AdvancedMarker position={{ lat: position[0], lng: position[1] }}>
      <div
        className="flex items-center justify-center text-[12px] font-bold text-white"
        style={{
          width: 26,
          height: 26,
          marginBottom: -13, // anchor the circle's center on the point
          borderRadius: '50%',
          background: '#7C3AED',
          border: '2px solid white',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }}
      >
        {index}
      </div>
    </AdvancedMarker>
  )
}

export default memo(StopPin, (a, b) =>
  a.index === b.index &&
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1]
)
