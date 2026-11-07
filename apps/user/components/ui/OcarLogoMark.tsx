import { cn } from '@/lib/utils'

export type LogoMarkSize = 'sm' | 'md' | 'lg' | 'xl'

interface OcarLogoMarkProps {
  size?: LogoMarkSize
  className?: string
}

// The mark is a wide image (~2.4:1) — height drives the box, width follows the art's aspect ratio.
// Two WebP files: the small one (320 px wide, ~3x the largest small size) is all a header logo needs; the 640 px one is for the big
// splash/login sizes. The 213 KB PNG this replaced was the largest thing on the home page and its Largest Contentful Paint element.
const LOGO_ASPECT = 640 / 267

const HEIGHT_PX: Record<LogoMarkSize, number> = {
  sm: 24,
  md: 34,
  lg: 52,
  xl: 88,
}

export default function OcarLogoMark({ size = 'md', className }: OcarLogoMarkProps) {
  const h = HEIGHT_PX[size]
  const w = Math.round(h * LOGO_ASPECT)
  return (
    <img
      src={h <= HEIGHT_PX.md ? '/logo-mark-sm.webp' : '/logo-mark.webp'}
      alt="Ocar"
      width={w}
      height={h}
      className={cn('inline-block object-contain', className)}
      style={{ width: w, height: h }}
    />
  )
}
