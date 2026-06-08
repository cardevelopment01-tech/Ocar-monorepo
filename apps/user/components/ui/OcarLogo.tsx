import { cn } from '@/lib/utils'

type LogoSize = 'sm' | 'md' | 'lg'

interface OcarLogoProps {
  className?: string
  size?: LogoSize
}

const sizeClasses: Record<LogoSize, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
}

export default function OcarLogo({ className, size = 'md' }: OcarLogoProps) {
  return (
    <span className={cn('font-bold tracking-tight', sizeClasses[size], className)}>
      <span className="text-primary">O</span>
      <span className="text-text-primary">car</span>
    </span>
  )
}
