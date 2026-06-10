'use client'

import { memo } from 'react'
import { Marker } from 'react-leaflet'
import L from 'leaflet'

type PinVariant = 'pickup' | 'drop'

interface LocationPinProps {
  position: [number, number]
  variant: PinVariant
}

function createPinIcon(variant: PinVariant) {
  const isPickup = variant === 'pickup'
  const bg = isPickup ? '#2563EB' : '#0F172A'

  const html = `
    <div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
      ${isPickup ? `
        <div style="
          position:absolute;width:36px;height:36px;border-radius:50%;
          background:rgba(37,99,235,0.18);
          animation:ping 1.8s cubic-bezier(0,0,0.2,1) infinite;
        "></div>
      ` : ''}
      <div style="
        width:18px;height:18px;border-radius:50%;
        background:${bg};border:2px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.25);
        display:flex;align-items:center;justify-content:center;
        position:relative;z-index:1;
      ">
        <div style="width:6px;height:6px;border-radius:50%;background:white;"></div>
      </div>
    </div>
    <style>
      @keyframes ping {
        75%,100% { transform:scale(2); opacity:0; }
      }
    </style>
  `

  return L.divIcon({
    html,
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}

// Only two variants ever exist — build each icon once and reuse it.
const PIN_ICONS: Record<PinVariant, L.DivIcon> = {
  pickup: createPinIcon('pickup'),
  drop:   createPinIcon('drop'),
}

function LocationPin({ position, variant }: LocationPinProps) {
  return <Marker position={position} icon={PIN_ICONS[variant]} />
}

export default memo(LocationPin, (a, b) =>
  a.variant === b.variant &&
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1]
)
