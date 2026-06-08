export const mockUser = {
  name: 'Rajan Kumar',
  phone: '98765 43210',
  walletBalance: 250,
  rating: 4.9,
}

export const mockDriver = {
  name: 'Suresh Patel',
  rating: 4.8,
  totalRides: 1243,
  vehicle: 'White Maruti Dzire',
  plate: 'OD05AB1234',
  photo: null,
  eta: 3,
  lat: 20.2980,
  lng: 85.8260,
}

export const mockVehicles = [
  {
    id: 1,
    name: 'Hatchback',
    emoji: '🚗',
    capacity: '4 seats',
    eta: '5 min',
    price: 185,
    originalPrice: null,
    isEco: false,
  },
  {
    id: 2,
    name: 'Sedan',
    emoji: '🚙',
    capacity: '4 seats',
    eta: '8 min',
    price: 245,
    originalPrice: null,
    isEco: false,
  },
  {
    id: 3,
    name: 'SUV',
    emoji: '🛻',
    capacity: '6 seats',
    eta: '12 min',
    price: 385,
    originalPrice: null,
    isEco: false,
  },
  {
    id: 4,
    name: 'EV Ride',
    emoji: '⚡',
    capacity: '4 seats',
    eta: '6 min',
    price: 200,
    originalPrice: 230,
    isEco: true,
  },
]

export const mockRideHistory = [
  {
    id: '1',
    pickup: 'MG Road, Bhubaneswar',
    drop: 'Bhubaneswar Airport',
    date: '2 Jun, 10:45 AM',
    fare: 385,
    status: 'completed' as const,
    rating: 5,
    vehicleType: 'SUV',
  },
  {
    id: '2',
    pickup: 'Infocity, Chandrasekharpur',
    drop: 'Patia Square',
    date: '28 May, 6:30 PM',
    fare: 120,
    status: 'completed' as const,
    rating: 4,
    vehicleType: 'Hatchback',
  },
  {
    id: '3',
    pickup: 'AIIMS Bhubaneswar',
    drop: 'Jaydev Vihar',
    date: '25 May, 2:15 PM',
    fare: 0,
    status: 'cancelled' as const,
    rating: null,
    vehicleType: 'Sedan',
  },
]

export const mockTransactions = [
  { id: 't1', type: 'credit' as const, label: 'Ride cashback', date: '2 Jun', amount: 12 },
  { id: 't2', type: 'debit' as const, label: 'Ride payment', date: '2 Jun', amount: 385 },
  { id: 't3', type: 'credit' as const, label: 'Added via UPI', date: '1 Jun', amount: 500 },
  { id: 't4', type: 'credit' as const, label: 'Referral bonus', date: '28 May', amount: 100 },
  { id: 't5', type: 'debit' as const, label: 'Ride payment', date: '22 May', amount: 245 },
]

export const mockPickup = {
  lat: 20.2961,
  lng: 85.8245,
  label: 'Sahid Nagar, Bhubaneswar',
}

export const mockDrop = {
  lat: 20.2700,
  lng: 85.8400,
  label: 'Bhubaneswar Airport',
}

export const mockRoute: [number, number][] = [
  [20.2961, 85.8245],
  [20.2900, 85.8280],
  [20.2830, 85.8320],
  [20.2750, 85.8370],
  [20.2700, 85.8400],
]

export const mockNearbyDrivers = [
  { id: 'd1', lat: 20.2990, lng: 85.8200, heading: 45 },
  { id: 'd2', lat: 20.2940, lng: 85.8310, heading: 180 },
  { id: 'd3', lat: 20.3010, lng: 85.8270, heading: 270 },
]
