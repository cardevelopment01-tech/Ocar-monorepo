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
  /** The flagged document was never uploaded (e.g. an RC back owed by a legacy driver), not rejected by review. */
  isMissingUpload: boolean
}

export type DriverSession = {
  id: string
  mode: 'standard' | 'return_cab'
  vehicleId: number
  categoryId: number
}

export type City = { id: number; name: string; slug: string }
