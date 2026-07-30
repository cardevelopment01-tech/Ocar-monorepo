import { cn } from '@/lib/utils'

export type LogoMarkSize = 'sm' | 'md' | 'lg' | 'xl'

interface OcarLogoMarkProps {
  size?: LogoMarkSize
  className?: string
  showWordmark?: boolean
}

const RING_PX: Record<LogoMarkSize, number> = {
  sm: 20,
  md: 28,
  lg: 40,
  xl: 64,
}

const WORDMARK_PX: Record<LogoMarkSize, number> = {
  sm: 13,
  md: 17,
  lg: 22,
  xl: 26,
}

export default function OcarLogoMark({ size = 'md', className, showWordmark = false }: OcarLogoMarkProps) {
  const px = RING_PX[size]
  const img = (
    <img
      src="/logo-mark.png"
      alt={showWordmark ? '' : 'Ocar'}
      width={px}
      height={px}
      className={cn('inline-block object-contain', !showWordmark && className)}
      style={{ width: px, height: px }}
    />
  )

  if (!showWordmark) return img

  return (
    <span className={cn('inline-flex flex-col items-center', className)}>
      {img}
      <span
        style={{
          marginTop: 8,
          fontWeight: 700,
          fontSize: WORDMARK_PX[size],
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        Ocar
      </span>
    </span>
  )
}
