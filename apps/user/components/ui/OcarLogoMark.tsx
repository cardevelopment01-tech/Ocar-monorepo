import { cn } from '@/lib/utils'

export type LogoMarkSize = 'sm' | 'md' | 'lg' | 'xl'

interface OcarLogoMarkProps {
  size?: LogoMarkSize
  className?: string
}

const RING_PX: Record<LogoMarkSize, number> = {
  sm: 20,
  md: 28,
  lg: 40,
  xl: 64,
}

export default function OcarLogoMark({ size = 'md', className }: OcarLogoMarkProps) {
  const px = RING_PX[size]

  return (
    <img
      src="/logo-mark.png"
      alt="Ocar"
      width={px}
      height={px}
      className={cn('inline-block object-contain', className)}
      style={{ width: px, height: px }}
    />
  )
}
