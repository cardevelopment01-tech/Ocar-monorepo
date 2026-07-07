'use client'

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
    : 'Schedule for later'

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`flex-1 py-3 rounded-full text-sm font-semibold transition-colors ${
            !value ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          Ride now
        </button>
        <button
          type="button"
          onClick={onOpenPicker}
          className={`flex-1 py-3 rounded-full text-sm font-semibold transition-colors ${
            value ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          {label}
        </button>
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
