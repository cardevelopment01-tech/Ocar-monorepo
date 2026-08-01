export type UploadState = 'idle' | 'uploading' | 'done' | 'error'

export interface SlotState {
  state: UploadState
  url: string | null
  error: string | null
  docStatus: string | null
  rejectionNote: string | null
}

export interface SlotDef {
  key: string
  slotLabel: string   // 'Front' | 'Back' | '' for single-slot groups
  accept: string
  isVehicle: boolean
}

export interface DocGroupDef {
  groupKey: string
  label: string
  required: boolean
  slots: SlotDef[]
  hasExpiry: boolean
  expiryRequired: boolean
}
