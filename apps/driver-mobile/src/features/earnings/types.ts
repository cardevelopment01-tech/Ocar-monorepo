export type Trip = {
  id: string
  status: string
  rideType: string
  originAddress: string | null
  destinationAddress: string | null
  requestedAt: string
  startedAt: string | null
  completedAt: string | null
  userName: string | null
  fare: string | null
  driverEarning: string
}

export type EarningsSummary = {
  totalEarnings: number
  tripCount: number
  onlineHours: string
  rating: number | null
  chart: number[]
  chartLabels: string[]
  breakdown: { baseFare: number; tips: number; incentives: number; platformFee: number }
}

export type EarningsPeriod = 'today' | 'week' | 'month'
