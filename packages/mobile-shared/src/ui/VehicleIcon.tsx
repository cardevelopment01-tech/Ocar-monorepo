import { Image, type ImageStyle, type StyleProp } from 'react-native'
import hatchbackImg from '../assets/vehicles/hatchback.webp'
import sedanImg from '../assets/vehicles/sedan.webp'
import suvImg from '../assets/vehicles/suv.webp'
import luxuryImg from '../assets/vehicles/luxury.webp'
import vanImg from '../assets/vehicles/van.webp'
import autoRickshawImg from '../assets/vehicles/auto_rickshaw.webp'

/**
 * VehicleIcon: studio-rendered vehicle illustrations for the ride selection
 * sheet, matching the Uber/Rapido convention of a real (if stylized) vehicle
 * render rather than a flat monochrome silhouette. Source PNGs are 640x400
 * transparent-background renders (see assets/vehicles/source for the raw
 * generations); each already carries its own paint color, so there's no
 * `color` prop to tint them the way the old SVG silhouettes had.
 */

export type VehicleIconProps = {
  slug: string
  /** height in px; width derived from each image's own aspect ratio */
  size?: number
  style?: StyleProp<ImageStyle>
}

const ASPECT = 640 / 400

const IMAGES: Record<string, number> = {
  hatchback: hatchbackImg,
  sedan: sedanImg,
  suv: suvImg,
  luxury: luxuryImg,
  van: vanImg,
  // Live category slug is 'auto' (confirmed via GET /api/v1/vehicles/categories) --
  // 'auto_rickshaw' is kept too since that's what the local migration file
  // (097_auto_rickshaw_category.sql) uses, and the two have drifted.
  auto: autoRickshawImg,
  auto_rickshaw: autoRickshawImg,
}

export function VehicleIcon({ slug, size = 44, style }: VehicleIconProps) {
  const source = IMAGES[slug] ?? IMAGES['sedan']
  return (
    <Image
      source={source}
      style={[{ width: size * ASPECT, height: size }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  )
}
