import { useRef, useState, useEffect } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { ChevronsRight, Check } from 'lucide-react'

// Slide-to-confirm — accident-proof advance for a driving driver (a deliberate
// horizontal drag, not a tap that a mounted phone hits by mistake). Snaps back
// if released before the threshold; resets after a beat if the action doesn't
// advance the trip (e.g. the network call failed), so it never gets stuck.
const HANDLE = 52
const THRESHOLD = 0.7
const PAD = 4

interface Props {
  label: string
  onConfirm: () => void
  disabled?: boolean
  color?: string
}

export default function SwipeToConfirm({ label, onConfirm, disabled = false, color = '#4F46E5' }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [maxX, setMaxX] = useState(0)
  const [done, setDone] = useState(false)
  const x = useMotionValue(0)
  const fillWidth = useTransform(x, (v) => v + HANDLE)

  useEffect(() => {
    const measure = () => { if (trackRef.current) setMaxX(Math.max(0, trackRef.current.offsetWidth - HANDLE - PAD * 2)) }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  function handleDragEnd() {
    if (done || maxX === 0) return
    if (x.get() >= maxX * THRESHOLD) {
      setDone(true)
      animate(x, maxX, { type: 'spring', stiffness: 420, damping: 42 })
      navigator.vibrate?.(30)
      onConfirm()
      // If the trip didn't advance (this component still mounted), let the driver retry.
      resetTimer.current = setTimeout(() => {
        setDone(false)
        animate(x, 0, { type: 'spring', stiffness: 500, damping: 44 })
      }, 1800)
    } else {
      animate(x, 0, { type: 'spring', stiffness: 500, damping: 44 })
    }
  }

  return (
    <div
      ref={trackRef}
      className="relative w-full rounded-full overflow-hidden select-none"
      style={{ height: HANDLE, background: '#EEF2FF', opacity: disabled ? 0.5 : 1, padding: PAD }}
    >
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: fillWidth, background: color, opacity: 0.16 }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center text-[14px] font-bold pointer-events-none"
        style={{ color }}
      >
        {done ? 'Confirmed' : label}
      </span>
      <motion.div
        drag={disabled || done ? false : 'x'}
        dragConstraints={{ left: 0, right: maxX }}
        dragElastic={0.02}
        dragMomentum={false}
        style={{ x, width: HANDLE - PAD * 2, height: HANDLE - PAD * 2 }}
        onDragEnd={handleDragEnd}
        className="absolute rounded-full flex items-center justify-center touch-none"
      >
        <span
          className="w-full h-full rounded-full flex items-center justify-center"
          style={{ background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.22)' }}
        >
          {done ? <Check size={20} style={{ color }} /> : <ChevronsRight size={20} style={{ color }} />}
        </span>
      </motion.div>
    </div>
  )
}
