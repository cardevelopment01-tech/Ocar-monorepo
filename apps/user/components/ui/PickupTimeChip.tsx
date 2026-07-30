'use client'

import { Clock, ChevronDown, X } from 'lucide-react'
import { motion } from 'framer-motion'
import SchedulePickerSheet from './SchedulePickerSheet'
import { formatPickupTime } from '@/lib/format-pickup-time'
import { MIN_ADVANCE_MINUTES, MAX_ADVANCE_DAYS } from '@/lib/advance-booking-limits'

const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

// DESIGN.md: colors.primary-subtle / colors.primary
const ICON_BG = '#E4F8FA'
const ICON_CLR = '#0A9FB0'

interface Props {
  value: Date | null
  pickerOpen: boolean
  onOpenPicker: () => void
  onClosePicker: () => void
  onChange: (date: Date | null) => void
}

export default function PickupTimeChip({ value, pickerOpen, onOpenPicker, onClosePicker, onChange }: Props) {
  const min = new Date(Date.now() + MIN_ADVANCE_MINUTES * 60_000)
  const max = new Date(Date.now() + MAX_ADVANCE_DAYS * 24 * 60 * 60_000)

  return (
    <>
      <motion.button
        type="button"
        onClick={onOpenPicker}
        whileTap={{ scale: 0.97 }}
        transition={SPRING}
        className={`h-9 inline-flex items-center gap-2 pl-1.5 pr-3 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 ${value ? '' : 'border border-slate-200 bg-white shadow-sm'}`}
        style={value ? { background: ICON_BG, border: `1px solid ${ICON_CLR}33` } : undefined}
      >
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: value ? ICON_CLR : ICON_BG }}
        >
          <Clock size={12} strokeWidth={2.2} color={value ? '#fff' : ICON_CLR} />
        </span>
        <span
          className={`text-[13px] font-semibold ${value ? '' : 'text-slate-700'}`}
          style={value ? { color: ICON_CLR } : undefined}
        >
          {value ? formatPickupTime(value) : 'Now'}
        </span>
        {value ? (
          <span
            role="button"
            aria-label="Reset to ride now"
            onClick={(e) => { e.stopPropagation(); onChange(null) }}
            className="w-5 h-5 -mr-1.5 flex items-center justify-center rounded-full flex-shrink-0"
          >
            <X size={12} strokeWidth={2.4} style={{ color: ICON_CLR }} />
          </span>
        ) : (
          <ChevronDown size={12} strokeWidth={2.4} className="text-slate-400 flex-shrink-0" />
        )}
      </motion.button>

      <SchedulePickerSheet
        open={pickerOpen}
        value={value}
        min={min}
        max={max}
        onChange={(date) => { onChange(date); onClosePicker() }}
        onClose={onClosePicker}
      />
    </>
  )
}
