// "Ocar Light" for the public trip page: the same Google Maps style the rider app draws (packages/mobile-shared/src/theme/mapStyle.ts),
// so a relative sees the same quiet pale-teal map the rider sees. A desaturated basemap (white roads, muted grey labels, no business
// icons or transit) leaves the route line, pins and the car as the only colour on screen.
//
// A JSON style only applies to a map WITHOUT a Map ID (a Map ID takes its look from Google Cloud Console and ignores this), which is
// why this page draws its own car and pins as overlays instead of AdvancedMarkers. A test keeps this list equal to the app's.

export type MapStyleRule = { featureType?: string; elementType?: string; stylers: Array<Record<string, string | number>> }

export const OCAR_LIGHT: MapStyleRule[] = [
  { elementType: 'geometry', stylers: [{ color: '#EEF6F6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6E8085' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F6FBFB' }, { weight: 3 }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#4E6469' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#E8F1F1' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#E0F0EA' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#DCEBEC' }, { weight: 0.8 }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#94A5A9' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#C9DFE2' }, { weight: 1 }] },
  { featureType: 'road.highway', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D2E9EC' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7FA5AC' }] },
]

/** The page's own canvas colour, shown while tiles load (the same as the rider app's `loadingBackgroundColor`). */
export const MAP_BACKGROUND = '#F6FBFB'

/** Route line: brand teal over a white casing (reads on both roads and parks), the same as the rider app's ROUTE. */
export const ROUTE_LINE = { core: '#0E8FA3', casing: '#FFFFFF', coreWidth: 5, casingWidth: 9 } as const
