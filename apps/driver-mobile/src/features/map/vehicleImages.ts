import hatchback from '../../../assets/map/vehicle-hatchback.webp'
import sedan from '../../../assets/map/vehicle-sedan.webp'
import suv from '../../../assets/map/vehicle-suv.webp'
import luxury from '../../../assets/map/vehicle-luxury.webp'
import van from '../../../assets/map/vehicle-van.webp'
import auto from '../../../assets/map/vehicle-auto.webp'
import type { VehicleKind } from './vehicleKind'

// The map marker images. Each name has a 1x file and @2x/@3x/@4x files beside it (assets/map): Metro bundles every density and the
// OS picks the one that matches the screen, so the marker is the same size on every phone. They are ready-made images, so the map has
// no drawing to capture (the old SVG car could be captured blank and stay invisible until something redrew it).
export const VEHICLE_IMAGES: Record<VehicleKind, number> = { hatchback, sedan, suv, luxury, van, auto }
