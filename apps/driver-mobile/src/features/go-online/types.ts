export type VehicleInfo = {
  id: number
  categoryId: number
  numberPlate: string
  status: string
}

export type WalletInfo = {
  balance: number
  isFrozen: boolean
  /** The server's minimum balance to go online; null when the server did not send one. */
  minBalance: number | null
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
  /** Return-cab destination city, sent with the current session so a relaunch can still name it. */
  destinationCityName?: string | null
}

export type City = { id: number; name: string; slug: string }
