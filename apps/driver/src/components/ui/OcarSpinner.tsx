import { useId } from 'react'

import { motion, useReducedMotion } from 'framer-motion'

type SpinnerVariant = 'color' | 'white' | 'mono'

interface OcarSpinnerProps {
  size?: number
  variant?: SpinnerVariant
  className?: string
}

const ARC_PATH = 'M 50 10 A 40 40 0 0 1 84.641 70'
const HEAD_CX = 50
const HEAD_CY = 10

export default function OcarSpinner({ size = 24, variant = 'color', className }: OcarSpinnerProps) {
  const gradientId = useId()
  const reduce = useReducedMotion()

  const baseColor =
    variant === 'white' ? '#FFFFFF' : variant === 'mono' ? '#334155' : '#4F46E5'
  const headColor =
    variant === 'white' ? '#FFFFFF' : variant === 'mono' ? '#334155' : '#7C3AED'

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="status"
      aria-label="Loading"
      className={className}
      animate={reduce ? undefined : { rotate: 360 }}
      transition={
        reduce
          ? undefined
          : { duration: 0.8, ease: 'linear', repeat: Infinity }
      }
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="50" y1="10" x2="84.641" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={headColor} stopOpacity="1" />
          <stop offset="100%" stopColor={baseColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={ARC_PATH}
        stroke={variant === 'color' ? `url(#${gradientId})` : baseColor}
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
        style={variant !== 'color' ? { opacity: 0.35 } : undefined}
      />
      <circle cx={HEAD_CX} cy={HEAD_CY} r={5} fill={headColor} />
    </motion.svg>
  )
}
