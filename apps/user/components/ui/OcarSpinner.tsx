'use client'

import { useId } from 'react'

import { motion, useReducedMotion } from 'framer-motion'

type SpinnerVariant = 'color' | 'white' | 'mono'

interface OcarSpinnerProps {
  size?: number
  variant?: SpinnerVariant
  className?: string
}

// Comet arc: 120° arc from ~−30° to ~90° (head at top-right, tail fading to left)
// Center (50,50), r=40. Arc goes from (84.64, 30) to (50, 90).
// But we use a gradient from opaque (head) to transparent (tail) by layering.
// The arc path: start at top (−90°=270°) and sweep 120° clockwise.
// Top: (50, 10). 120° clockwise end: cos(30°)*40+50=84.64, sin(30°)*40+50=70.
// Path: M 50 10 A 40 40 0 0 1 84.64 70
// Small head dot at (50,10), the arc's leading end.
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
        {/* Gradient along the arc: head (opaque) to tail (transparent) */}
        <linearGradient id={gradientId} x1="50" y1="10" x2="84.641" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={headColor} stopOpacity="1" />
          <stop offset="100%" stopColor={baseColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Tapered comet tail */}
      <path
        d={ARC_PATH}
        stroke={variant === 'color' ? `url(#${gradientId})` : baseColor}
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
        strokeOpacity={variant === 'color' ? 1 : undefined}
        style={variant !== 'color' ? { opacity: 0.35 } : undefined}
      />

      {/* Comet head dot */}
      <circle cx={HEAD_CX} cy={HEAD_CY} r={5} fill={headColor} />
    </motion.svg>
  )
}
