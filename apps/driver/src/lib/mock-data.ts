export const mockDriver = {
  name: 'Ramesh Kumar',
  code: 'DRV2614',
  phone: '98765 43210',
  rating: 4.9,
  totalRatings: 234,
  totalTrips: 847,
  memberSince: 'March 2024',
  badge: 'Gold',
  acceptanceRate: 94,
  completionRate: 97,
  cancellationRate: 3,
  vehicle: {
    name: 'Maruti Dzire',
    plate: 'OD05AB1234',
    category: 'Sedan',
    color: 'White',
  },
  wallet: {
    balance: 420,
    minimum: 500,
  },
}

export const mockEarnings = {
  today: {
    total: 1240,
    trips: 8,
    hours: '6h 20m',
    rating: 4.9,
    chart: [0, 0, 120, 340, 280, 500, 0],
    chartLabels: ['6am', '8am', '10am', '12pm', '2pm', '4pm', '6pm'],
    breakdown: { baseFare: 1100, tips: 80, incentives: 60, platformFee: 0 },
  },
  week: {
    total: 8240,
    trips: 52,
    hours: '38h',
    rating: 4.9,
    chart: [1100, 1300, 900, 1240, 1200, 1100, 400],
    chartLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    breakdown: { baseFare: 7400, tips: 480, incentives: 360, platformFee: 0 },
  },
  month: {
    total: 32100,
    trips: 201,
    hours: '148h',
    rating: 4.9,
    chart: [7200, 8400, 9100, 7400],
    chartLabels: ['Wk1', 'Wk2', 'Wk3', 'Wk4'],
    breakdown: { baseFare: 28900, tips: 1800, incentives: 1400, platformFee: 0 },
  },
}

export const mockIncomingRequest = {
  id: 'RIDE_001',
  pickup: 'Sahid Nagar, Bhubaneswar',
  drop: 'Bhubaneswar Airport',
  pickupDistance: 1.2,
  tripDistance: 14.5,
  fare: 285,
  timeRemaining: 20,
}

export const mockTripHistory = [
  { id: '1', time: '10:45 AM', from: 'MG Road',        to: 'Airport',     fare: 385, distance: 12.3 },
  { id: '2', time: '8:30 AM',  from: 'Patia',           to: 'Infocity',    fare: 120, distance: 4.1  },
  { id: '3', time: '6:15 AM',  from: 'Railway Station', to: 'Sahid Nagar', fare: 95,  distance: 3.2  },
]

export const mockWalletTransactions = [
  { id: 'w1', type: 'debit'  as const, label: 'Ride #RIDE_001 commission', amount: 57,  date: '10:45 AM today' },
  { id: 'w2', type: 'credit' as const, label: 'Added via UPI',             amount: 500, date: 'Yesterday'      },
  { id: 'w3', type: 'debit'  as const, label: 'Ride #RIDE_892 commission', amount: 42,  date: 'Yesterday'      },
]

export const mockCurrentLocation: [number, number] = [20.2961, 85.8245]
export const mockPickupLocation:  [number, number] = [20.3010, 85.8180]
export const mockDropLocation:    [number, number] = [20.2700, 85.8400]
