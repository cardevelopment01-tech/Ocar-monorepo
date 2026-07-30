'use client'

import { memo } from 'react'
import { AdvancedMarker } from '@vis.gl/react-google-maps'

// Numbered waypoint pin — the map counterpart of RouteTimeline's violet stop
// chip. The number matches the chip so map and itinerary read as one trip
// (docs/MULTI_STOP_UI_REDESIGN_PLAN.md §4).
interface StopPinProps {
  position: [number, number]
  index: number
  onClick?: () => void
  selected?: boolean
}

function StopPin({ position, index, onClick, selected = false }: StopPinProps) {
  return (
    <AdvancedMarker position={{ lat: position[0], lng: position[1] }} onClick={onClick}>
      <div
        className="flex items-center justify-center text-[12px] font-bold text-white"
        style={{
          width: 26,
          height: 26,
          marginBottom: -13, // anchor the circle's center on the point
          borderRadius: '50%',
          background: '#DC3E93',
          border: '2px solid white',
          boxShadow: selected
            ? '0 0 0 3px rgba(220, 62, 147,0.40), 0 1px 4px rgba(0,0,0,0.3)'
            : '0 1px 4px rgba(0,0,0,0.3)',
          transform: selected ? 'scale(1.22)' : 'scale(1)',
          transition: 'transform 160ms ease, box-shadow 160ms ease',
          cursor: onClick ? 'pointer' : undefined,
        }}
      >
        {index}
      </div>
    </AdvancedMarker>
  )
}

export default memo(StopPin, (a, b) =>
  a.index === b.index &&
  a.selected === b.selected &&
  a.onClick === b.onClick &&
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1]
)
