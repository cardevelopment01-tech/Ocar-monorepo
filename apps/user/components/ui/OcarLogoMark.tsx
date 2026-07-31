import { cn } from '@/lib/utils'

export type LogoMarkSize = 'sm' | 'md' | 'lg' | 'xl'

interface OcarLogoMarkProps {
  size?: LogoMarkSize
  className?: string
}

// logo-mark.png is a wide mark (~2.4:1) — height drives the box, width follows the art's aspect ratio
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
      src="/logo-mark.png"
      alt="Ocar"
      width={w}
      height={h}
      className={cn('inline-block object-contain', className)}
      style={{ width: w, height: h }}
    />
  )
}
