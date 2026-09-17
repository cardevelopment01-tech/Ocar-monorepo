export type VehicleInfo = {
  id: number
  categoryId: number
  numberPlate: string
  status: string
}

export type WalletInfo = {
  balance: number
  isFrozen: boolean
}

export type DocumentGateStatus = {
  hasRejected: boolean
  rejectionReason: string | null
}

export type DriverSession = {
  id: string
  mode: 'standard' | 'return_cab'
  vehicleId: number
  categoryId: number
}
