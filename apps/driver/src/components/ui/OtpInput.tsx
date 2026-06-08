import { useRef, KeyboardEvent, ClipboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  length?: number
  value: string
  onChange: (value: string) => void
  error?: boolean
}

export default function OtpInput({ length = 4, value, onChange, error = false }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length)

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
    <div className="w-full overflow-hidden px-1">
      <div className="flex gap-2 w-full justify-center">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onPaste={handlePaste}
            className={cn(
              'flex-1 min-w-0 max-w-[52px] aspect-square',
              'text-center font-mono font-bold rounded-xl border-2 transition-all duration-150',
              'text-2xl text-text-primary bg-surface-2 caret-transparent',
              'focus:outline-none',
              error
                ? 'border-accent-red animate-[shake_0.3s_ease]'
                : digit
                  ? 'border-primary bg-primary-subtle text-primary'
                  : 'border-border focus:border-primary'
            )}
          />
        ))}
      </div>
    </div>
  )
}
