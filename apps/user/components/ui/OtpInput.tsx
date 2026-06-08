'use client'

import { useEffect, useRef, KeyboardEvent, ClipboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  length?: number
  disabled?: boolean
  error?: boolean
}

export default function OtpInput({ value, onChange, length = 6, disabled = false, error = false }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length)

  // Auto-focus box 0 on mount and whenever value is reset to '' (e.g. after wrong OTP)
  useEffect(() => {
    if (value !== '') return
    const t = setTimeout(() => refs.current[0]?.focus(), 50)
    return () => clearTimeout(t)
  }, [value])

  const handleChange = (index: number, char: string) => {
    if (!/^\d*$/.test(char)) return
    const next = [...digits]
    next[index] = char.slice(-1)
    onChange(next.join(''))
    if (char && index < length - 1) refs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    onChange(pasted)
    refs.current[Math.min(pasted.length, length - 1)]?.focus()
  }

  return (
    <div className="flex gap-2 justify-center w-full">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          className={cn(
            'w-11 h-[60px] text-center text-2xl font-bold rounded-2xl border-2',
            'transition-all duration-150 focus:outline-none caret-transparent select-none',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error
              ? 'border-status-error bg-status-error/5 text-status-error'
              : digit
                ? 'border-primary bg-primary/10 text-primary scale-[1.06]'
                : 'border-border bg-surface-2 text-text-primary focus:border-primary focus:bg-surface focus:scale-[1.06]'
          )}
        />
      ))}
    </div>
  )
}
