'use client'

import { useId } from 'react'

import { motion } from 'framer-motion'

type SpinnerVariant = 'color' | 'white' | 'mono'

interface OcarSpinnerProps {
  size?: number
  variant?: SpinnerVariant
  className?: string
}

export default function OcarSpinner({ size = 24, variant = 'color', className }: OcarSpinnerProps) {
  const gradientId = useId()
  const stroke =
    variant === 'white' ? '#FFFFFF' : variant === 'mono' ? '#334155' : `url(#${gradientId})`

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="status"
      aria-label="Loading"
      className={className}
      animate={{ rotate: 360 }}
      transition={{ duration: 1, ease: 'linear', repeat: Infinity }}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <path
        d="M 78.284 78.284 A 40 40 0 1 0 21.716 78.284"
        stroke={stroke}
        strokeWidth={9}
        strokeLinecap="round"
        fill="none"
      />
      <circle cx={78.284} cy={78.284} r={7} fill={stroke} />
    </motion.svg>
  )
}
