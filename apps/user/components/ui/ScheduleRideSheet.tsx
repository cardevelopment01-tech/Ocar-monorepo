'use client'

import { Clock } from 'lucide-react'
import DateTimePickerSheet from './DateTimePickerSheet'

const MIN_ADVANCE_MINUTES = 60
const MAX_ADVANCE_DAYS = 7

interface Props {
  value: Date | null
  pickerOpen: boolean
  onOpenPicker: () => void
  onClosePicker: () => void
  onChange: (date: Date | null) => void
}

export default function ScheduleRideSheet({ value, pickerOpen, onOpenPicker, onClosePicker, onChange }: Props) {
  const min = new Date(Date.now() + MIN_ADVANCE_MINUTES * 60_000)
  const max = new Date(Date.now() + MAX_ADVANCE_DAYS * 24 * 60 * 60_000)

  const label = value
    ? value.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    : 'Now'

  return (
    <>
      <div
        className="rounded-2xl px-3 py-2.5"
        style={{ background: '#F5F7FF', border: '1px solid #E8EEFF' }}
      >
        <p className="text-[10px] font-semibold tracking-wide mb-2" style={{ color: '#94A3B8' }}>PICKUP TIME</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${
              !value ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            <Clock size={13} strokeWidth={2.2} />
            Ride now
          </button>
          <button
            type="button"
            onClick={onOpenPicker}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${
              value ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            <Clock size={13} strokeWidth={2.2} />
            {label}
          </button>
        </div>
      </div>

      <DateTimePickerSheet
        open={pickerOpen}
        value={value}
        min={min}
        max={max}
        title="Schedule your ride"
        subtitle={`At least 1 hour ahead, up to ${MAX_ADVANCE_DAYS} days`}
        timeLabel="PICKUP TIME"
        onConfirm={(date) => { onChange(date); onClosePicker() }}
        onClose={onClosePicker}
      />
    </>
  )
}
