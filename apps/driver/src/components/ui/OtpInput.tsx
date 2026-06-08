import { useEffect, useRef, KeyboardEvent, ClipboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  length?: number
  value: string
  onChange: (value: string) => void
  error?: boolean
}

export default function OtpInput({ length = 6, value, onChange, error = false }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length)

  // Auto-focus first box on mount (works on PC and Android)
  useEffect(() => {
    const t = setTimeout(() => refs.current[0]?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  const handleChange = (i: number, char: string) => {
    if (!/^\d*$/.test(char)) return
    const next = [...digits]
    next[i] = char.slice(-1)
    onChange(next.join(''))
    if (char && i < length - 1) refs.current[i + 1]?.focus()
  }

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
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
          className={cn(
            'w-11 h-[60px] text-center text-2xl font-bold rounded-2xl border-2',
            'transition-all duration-150 focus:outline-none caret-transparent select-none',
            error
              ? 'border-accent-red bg-accent-red/5 text-accent-red animate-[shake_0.3s_ease]'
              : digit
                ? 'border-primary bg-primary-subtle text-primary scale-[1.06]'
                : 'border-border bg-surface-2 text-text-primary focus:border-primary focus:bg-surface focus:scale-[1.06]'
          )}
        />
      ))}
    </div>
  )
}
