import type { MapViewProps } from 'react-native-maps'

/**
 * "Ocar Light", one Google Maps style shared by every map in the rider app, tuned to the
 * home screen's palette (canvas #F6FBFB, teal #0E8FA3). The approach mirrors the big ride apps:
 * a quiet, desaturated basemap (white roads on a pale wash, muted grey labels, no business
 * POIs / transit clutter) so the route line, pins and cars are the only colour on screen.
 */
export const OCAR_MAP_STYLE: NonNullable<MapViewProps['customMapStyle']> = [
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

/** Same style with every label off, for small decorative maps (home hero) where clipped street names read as noise. */
export const OCAR_MAP_STYLE_QUIET: NonNullable<MapViewProps['customMapStyle']> = [
  ...OCAR_MAP_STYLE,
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
  // some renderers only honour label rules that name a feature, so spell the main ones out
  ...['road', 'road.arterial', 'road.highway', 'road.local', 'administrative', 'landscape', 'water', 'poi', 'transit'].flatMap((featureType) => [
    { featureType, elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
    { featureType, elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  ]),
]

/** Props every rider MapView shares: the style above minus the stock Google chrome. */
export const OCAR_MAP_PROPS = {
  customMapStyle: OCAR_MAP_STYLE,
  toolbarEnabled: false,
  showsCompass: false,
  showsPointsOfInterest: false,
  showsBuildings: false,
  showsTraffic: false,
  showsIndoors: false,
  loadingBackgroundColor: '#F6FBFB',
  loadingIndicatorColor: '#0E8FA3',
} as const

/** Route line colours: brand teal over a white casing (reads on both roads and parks). */
export const ROUTE = { core: '#0E8FA3', casing: '#FFFFFF', coreWidth: 5, casingWidth: 9 } as const
