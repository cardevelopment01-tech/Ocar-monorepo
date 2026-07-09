'use client'

import { Clock, ChevronDown, X } from 'lucide-react'
import { motion } from 'framer-motion'
import SchedulePickerSheet from './SchedulePickerSheet'
import { formatPickupTime } from '@/lib/format-pickup-time'
import { MIN_ADVANCE_MINUTES, MAX_ADVANCE_DAYS } from '@/lib/advance-booking-limits'

const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

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
        className={`h-9 inline-flex items-center gap-1.5 px-3.5 rounded-full ${value ? '' : 'border border-slate-200 text-slate-700'}`}
        style={value
          ? { background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4338CA' }
          : { background: '#fff' }
        }
      >
        <Clock size={14} strokeWidth={1.8} />
        <span className="text-[13px] font-semibold">{value ? formatPickupTime(value) : 'Now'}</span>
        {value ? (
          <span
            role="button"
            aria-label="Reset to ride now"
            onClick={(e) => { e.stopPropagation(); onChange(null) }}
            className="w-6 h-6 -mr-1.5 flex items-center justify-center"
          >
            <X size={12} strokeWidth={2.2} />
          </span>
        ) : (
          <ChevronDown size={12} strokeWidth={2.2} />
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
