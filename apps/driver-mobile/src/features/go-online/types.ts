import type { DocIssue } from './docIssues'

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
  /** Something keeps the driver from going online: a rejected, expired, unreviewed or missing document. */
  hasRejected: boolean
  rejectionReason: string | null
  /** The banner title that matches the reason(s), for example "Document expired"; null from an older server. */
  title: string | null
  /** Every blocking document and why, as the server reports it; empty from an older server. */
  issues: DocIssue[]
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
