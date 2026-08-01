import { AlertCircle, CheckCircle2 } from 'lucide-react'
import DatePickerSheet from '@/components/ui/DatePickerSheet'
import DocSlot from './DocSlot'
import type { DocGroupDef, SlotDef, SlotState } from './types'

const TODAY_ISO = new Date().toISOString().slice(0, 10)

interface DocGroupCardProps {
  group: DocGroupDef
  slotState: Record<string, SlotState>
  validUntil: string
  fileRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>
  onFileSelect: (slot: SlotDef, file: File) => void
  onValidUntilChange: (v: string) => void
  onPreview: (url: string, label: string) => void
}

export default function DocGroupCard({ group, slotState, validUntil, fileRefs, onFileSelect, onValidUntilChange, onPreview }: DocGroupCardProps) {
  const allUploaded = group.slots.every(s => slotState[s.key]?.state === 'done')
  const anyRejected = group.slots.some(s => slotState[s.key]?.docStatus === 'rejected')
  const isComplete  = allUploaded && (!group.hasExpiry || !group.expiryRequired || !!validUntil)

  const borderClass = anyRejected ? 'border-amber-500/40' : isComplete ? 'border-green-500/30' : 'border-border'

  return (
    <div className={`rounded-2xl border-2 bg-surface-2 transition-colors ${borderClass}`}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          {anyRejected      && <AlertCircle  size={15} className="text-amber-500 flex-shrink-0" />}
          {isComplete && !anyRejected && <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />}
          <h3 className="text-sm font-bold text-text-primary truncate">{group.label}</h3>
        </div>
        <span className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full ml-3 ${
          group.required ? 'text-primary bg-primary/10' : 'text-text-muted bg-surface-3'
        }`}>
          {group.required ? 'Required' : 'Optional'}
        </span>
      </div>

      {/* Slots: 2-col for paired docs, full-width for single */}
      <div className={`px-3 pb-3 ${group.slots.length === 2 ? 'grid grid-cols-2 gap-2.5' : ''}`}>
        {group.slots.map(slot => (
          <DocSlot
            key={slot.key}
            slot={slot}
            state={slotState[slot.key]!}
            inputRef={el => { fileRefs.current[slot.key] = el }}
            onTrigger={() => fileRefs.current[slot.key]?.click()}
            onFileChange={file => onFileSelect(slot, file)}
            onPreview={() => {
              const u = slotState[slot.key]?.url
              if (u) onPreview(u, slot.slotLabel ? `${group.label} (${slot.slotLabel})` : group.label)
            }}
          />
        ))}
      </div>

      {/* Shared expiry date: belongs to the whole document, not one photo */}
      {group.hasExpiry && (
        <div className="mx-3 mb-3 pt-3 border-t border-border/40">
          <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 block">
            Expiry Date{group.expiryRequired && <span className="text-accent-red ml-0.5"> *</span>}
          </label>
          <DatePickerSheet
            label={`${group.label} Expiry`}
            value={validUntil}
            onChange={onValidUntilChange}
            minDate={TODAY_ISO}
            placeholder="Select expiry date"
          />
        </div>
      )}
    </div>
  )
}
