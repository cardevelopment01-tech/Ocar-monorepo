import OcarLogoMark, { type LogoMarkSize, type LogoVariant } from './OcarLogoMark'

type LogoSize = 'sm' | 'md' | 'lg' | 'xl'

interface OcarLogoProps {
  className?: string
  size?: LogoSize
  variant?: LogoVariant
}

export default function OcarLogo({ className, size = 'md', variant = 'color' }: OcarLogoProps) {
  return <OcarLogoMark size={size as LogoMarkSize} variant={variant} withWordmark className={className} />
}
