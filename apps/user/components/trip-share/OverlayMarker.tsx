'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from '@vis.gl/react-google-maps'

// A plain HTML marker on the map's own overlay layer. AdvancedMarker needs a Map ID, and a Map ID would stop the JSON style
// (map-style.ts) from applying; an overlay needs neither. It is also the cheapest way to move a car: `setPosition` moves it with
// one CSS transform, with no React render and no Maps marker bookkeeping.

export interface OverlayHandle {
  /** Moves the marker now. Safe to call every animation frame. */
  setPosition: (lat: number, lng: number) => void
}

interface Props {
  lat: number
  lng: number
  /** Above the route line (the default) or below another marker. */
  zIndex?: number
  children: ReactNode
}

/** The children are centred on the point. */
export const OverlayMarker = forwardRef<OverlayHandle, Props>(function OverlayMarker({ lat, lng, zIndex = 1, children }, ref) {
  const map = useMap()
  const [el] = useState(() => {
    const d = document.createElement('div')
    d.style.position = 'absolute'
    d.style.left = '0'
    d.style.top = '0'
    d.style.willChange = 'transform'
    return d
  })
  const pos = useRef({ lat, lng })
  const overlay = useRef<google.maps.OverlayView | null>(null)

  useImperativeHandle(ref, () => ({
    setPosition: (la, ln) => { pos.current = { lat: la, lng: ln }; overlay.current?.draw() },
  }), [])

  // A marker whose position comes from props (pins) follows them; the car passes a stable first position and uses the handle.
  useEffect(() => { pos.current = { lat, lng }; overlay.current?.draw() }, [lat, lng])
  useEffect(() => { el.style.zIndex = String(zIndex) }, [el, zIndex])

  useEffect(() => {
    if (!map) return
    const o = new google.maps.OverlayView()
    o.onAdd = () => { o.getPanes()?.markerLayer.appendChild(el) }
    o.draw = () => {
      const p = o.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(pos.current.lat, pos.current.lng))
      if (p) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
    }
    o.onRemove = () => { el.remove() }
    o.setMap(map)
    overlay.current = o
    return () => { o.setMap(null); overlay.current = null }
  }, [map, el])

  return createPortal(<div style={{ transform: 'translate(-50%, -50%)' }}>{children}</div>, el)
})
