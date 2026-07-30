'use client'

import { useId } from 'react'

import { cn } from '@/lib/utils'

export type LogoMarkSize = 'sm' | 'md' | 'lg' | 'xl'
export type LogoVariant = 'color' | 'white' | 'mono'

interface OcarLogoMarkProps {
  size?: LogoMarkSize
  variant?: LogoVariant
  withWordmark?: boolean
  className?: string
}

const RING_PX: Record<LogoMarkSize, number> = {
  sm: 20,
  md: 28,
  lg: 40,
  xl: 64,
}

const WORD_PX: Record<LogoMarkSize, number> = {
  sm: 16,
  md: 22,
  lg: 30,
  xl: 46,
}

const ARC_PATH = 'M 78.284 78.284 A 40 40 0 1 0 21.716 78.284'
const DOT_CX = 78.284
const DOT_CY = 78.284

function strokeColorFor(variant: LogoVariant, gradientId: string): string {
  if (variant === 'white') return '#FFFFFF'
  if (variant === 'mono') return '#334155'
  return `url(#${gradientId})`
}

function textColorFor(variant: LogoVariant): string {
  if (variant === 'white') return '#FFFFFF'
  if (variant === 'mono') return '#334155'
  return '#0F172A'
}

export default function OcarLogoMark({
  size = 'md',
  variant = 'color',
  withWordmark = true,
  className,
}: OcarLogoMarkProps) {
  const gradientId = useId()
  const ring = RING_PX[size]
  const stroke = strokeColorFor(variant, gradientId)

  return (
    <span className={cn('inline-flex items-center', className)}>
      <svg
        width={ring}
        height={ring}
        viewBox="0 0 100 100"
        fill="none"
        role="img"
        aria-label="Ocar"
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0A9FB0" />
            <stop offset="100%" stopColor="#DC3E93" />
          </linearGradient>
        </defs>
        <path
          d={ARC_PATH}
          stroke={stroke}
          strokeWidth={7.5}
          strokeLinecap="round"
          fill="none"
        />
        <circle cx={DOT_CX} cy={DOT_CY} r={8} fill={stroke} />
      </svg>
      {withWordmark && (
        <span
          style={{
            marginLeft: ring * 0.32,
            fontSize: WORD_PX[size],
            fontWeight: 600,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            color: textColorFor(variant),
            fontFamily: 'Inter, sans-serif',
          }}
        >
          ocar
        </span>
      )}
    </span>
  )
}
