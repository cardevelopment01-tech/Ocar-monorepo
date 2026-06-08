export type AdminRole = 'super_admin' | 'ops_admin' | 'finance_admin' | 'support_admin'

export const mockAdmin = {
  name: 'Aryan Mehta',
  email: 'aryan@ocar.in',
  role: 'super_admin' as AdminRole,
  initials: 'AM',
}

export const mockStats = {
  dashboard: {
    totalRidesToday:  1247,
    activeDrivers:    84,
    revenueToday:     284320,
    openDisputes:     12,
    completedRides:   1189,
    cancelledRides:   58,
    newDrivers:       23,
    activeTrips:      37,
    ridesLastHour:    [12, 18, 14, 22, 19, 25, 28, 24, 30, 27, 21, 15],
  },
}

export const mockRides = [
  {
    id: 'RIDE_001', code: 'RC-2026-001247',
    user:   { name: 'Priya Sharma',  phone: '+91 98765 43210' },
    driver: { name: 'Ramesh Kumar',  plate: 'OD05AB1234' },
    from: 'MG Road', to: 'Airport',
    type: 'one_way', fare: 385,
    status: 'completed', time: '2 min ago',
  },
  {
    id: 'RIDE_002', code: 'RC-2026-001246',
    user:   { name: 'Arjun Patel',   phone: '+91 87654 32109' },
    driver: { name: 'Suresh Nayak',  plate: 'OD02CD5678' },
    from: 'Patia', to: 'Infocity',
    type: 'one_way', fare: 120,
    status: 'in_progress', time: '8 min ago',
  },
  {
    id: 'RIDE_003', code: 'RC-2026-001245',
    user:   { name: 'Kavya Reddy',   phone: '+91 76543 21098' },
    driver: null,
    from: 'AIIMS', to: 'Jaydev Vihar',
    type: 'one_way', fare: 95,
    status: 'cancelled', time: '15 min ago',
  },
  {
    id: 'RIDE_004', code: 'RC-2026-001244',
    user:   { name: 'Rahul Singh',   phone: '+91 65432 10987' },
    driver: { name: 'Dinesh Rao',    plate: 'OD07EF9012' },
    from: 'Railway Station', to: 'Sahid Nagar',
    type: 'one_way', fare: 210,
    status: 'requested', time: '3 min ago',
  },
  {
    id: 'RIDE_005', code: 'RC-2026-001243',
    user:   { name: 'Meena Das',     phone: '+91 54321 09876' },
    driver: { name: 'Vijay Kumar',   plate: 'OD09GH3456' },
    from: 'Bhubaneswar Airport', to: 'Puri',
    type: 'one_way', fare: 1200,
    status: 'completed', time: '28 min ago',
  },
  {
    id: 'RIDE_006', code: 'RC-2026-001242',
    user:   { name: 'Sanjay Mishra', phone: '+91 43210 98765' },
    driver: { name: 'Ramesh Kumar',  plate: 'OD05AB1234' },
    from: 'Cuttack', to: 'Bhubaneswar',
    type: 'round_trip', fare: 850,
    status: 'completed', time: '45 min ago',
  },
]

export const mockDrivers = [
  {
    id: '1', code: 'DRV2614',
    name: 'Ramesh Kumar',
    email: 'ramesh@example.com',
    phone: '+91 98765 43210',
    status: 'active',
    rating: 4.9, totalRides: 1243,
    walletBalance: 420,
    vehicle: { name: 'Maruti Dzire', plate: 'OD05AB1234', category: 'Sedan' },
    joinedAt: '15 Mar 2024',
  },
  {
    id: '2', code: 'DRV2891',
    name: 'Suresh Nayak',
    email: 'suresh@example.com',
    phone: '+91 87654 32109',
    status: 'pending_approval',
    rating: 0, totalRides: 0,
    walletBalance: 500,
    vehicle: { name: 'Hyundai i20', plate: 'OD02CD5678', category: 'Hatchback' },
    joinedAt: '01 Jun 2024',
  },
  {
    id: '3', code: 'DRV3102',
    name: 'Dinesh Rao',
    email: 'dinesh@example.com',
    phone: '+91 76543 21098',
    status: 'suspended',
    rating: 3.8, totalRides: 234,
    walletBalance: 750,
    vehicle: { name: 'Tata Nexon', plate: 'OD07EF9012', category: 'SUV' },
    joinedAt: '10 Jan 2024',
  },
  {
    id: '4', code: 'DRV1877',
    name: 'Vijay Kumar',
    email: 'vijay@example.com',
    phone: '+91 65432 10987',
    status: 'active',
    rating: 4.7, totalRides: 892,
    walletBalance: 1200,
    vehicle: { name: 'Honda Amaze', plate: 'OD09GH3456', category: 'Sedan' },
    joinedAt: '22 Nov 2023',
  },
  {
    id: '5', code: 'DRV3455',
    name: 'Prashant Sahoo',
    email: 'prashant@example.com',
    phone: '+91 54321 09876',
    status: 'pending_docs',
    rating: 0, totalRides: 0,
    walletBalance: 0,
    vehicle: { name: 'Maruti Alto', plate: 'OD11IJ7890', category: 'Hatchback' },
    joinedAt: '05 Jun 2024',
  },
]

export const mockUsers = [
  { id: 'U001', name: 'Priya Sharma',  phone: '+91 98765 43210', email: 'priya@example.com',   status: 'active',    totalRides: 47,  walletBalance: 850,  joinedAt: '12 Jan 2024' },
  { id: 'U002', name: 'Arjun Patel',   phone: '+91 87654 32109', email: 'arjun@example.com',   status: 'active',    totalRides: 23,  walletBalance: 200,  joinedAt: '28 Feb 2024' },
  { id: 'U003', name: 'Kavya Reddy',   phone: '+91 76543 21098', email: 'kavya@example.com',   status: 'suspended', totalRides: 5,   walletBalance: 0,    joinedAt: '15 Apr 2024' },
  { id: 'U004', name: 'Rahul Singh',   phone: '+91 65432 10987', email: 'rahul@example.com',   status: 'active',    totalRides: 112, walletBalance: 1500, joinedAt: '03 Oct 2023' },
  { id: 'U005', name: 'Meena Das',     phone: '+91 54321 09876', email: 'meena@example.com',   status: 'active',    totalRides: 68,  walletBalance: 350,  joinedAt: '19 Sep 2023' },
]

export const mockDisputes = [
  {
    id: 'DSP_001', type: 'fare_overcharge',
    initiator: 'user', initiatorName: 'Priya Sharma',
    rideId: 'RIDE_001', rideCode: 'RC-2026-001247',
    status: 'open', priority: 'high',
    slaHours: 48, slaDue: '6h remaining',
    slaUrgency: 'critical' as const,
    description: 'Driver charged ₹450 instead of metered ₹385. Difference of ₹65.',
    assignedTo: null,
    createdAt: '42 min ago',
  },
  {
    id: 'DSP_002', type: 'driver_behaviour',
    initiator: 'user', initiatorName: 'Rahul Singh',
    rideId: 'RIDE_004', rideCode: 'RC-2026-001244',
    status: 'under_review', priority: 'normal',
    slaHours: 72, slaDue: '38h remaining',
    slaUrgency: 'ok' as const,
    description: 'Driver used inappropriate language during the ride.',
    assignedTo: 'Aryan Mehta',
    createdAt: '3 hours ago',
  },
  {
    id: 'DSP_003', type: 'trip_not_started',
    initiator: 'driver', initiatorName: 'Ramesh Kumar',
    rideId: 'RIDE_003', rideCode: 'RC-2026-001245',
    status: 'open', priority: 'normal',
    slaHours: 72, slaDue: '22h remaining',
    slaUrgency: 'warning' as const,
    description: 'User was not present at pickup location after 15 min wait.',
    assignedTo: null,
    createdAt: '5 hours ago',
  },
]

export const mockSOS = [
  {
    id: 'SOS_001',
    driver: { name: 'Ramesh Kumar', code: 'DRV2614', phone: '+91 98765 43210' },
    rideCode: 'RC-2026-001247',
    route: 'MG Road → Airport',
    location: 'Near Unit-4, Bhubaneswar',
    status: 'active',
    severity: 'high',
    elapsed: '4 min ago',
    resolvedAt: null,
  },
]

export const mockPayments = [
  { id: 'PAY_001', rideCode: 'RC-2026-001247', user: 'Priya Sharma',  driver: 'Ramesh Kumar', channel: 'online_upi',       amount: 385, commission: 77,  driverEarning: 308, status: 'completed', time: '2 min ago' },
  { id: 'PAY_002', rideCode: 'RC-2026-001246', user: 'Arjun Patel',   driver: 'Suresh Nayak', channel: 'cash_direct',      amount: 120, commission: 24,  driverEarning: 96,  status: 'pending',   time: '8 min ago' },
  { id: 'PAY_003', rideCode: 'RC-2026-001243', user: 'Meena Das',     driver: 'Vijay Kumar',  channel: 'online_card',      amount: 1200,commission: 240, driverEarning: 960, status: 'completed', time: '28 min ago' },
  { id: 'PAY_004', rideCode: 'RC-2026-001242', user: 'Sanjay Mishra', driver: 'Ramesh Kumar', channel: 'platform_wallet',  amount: 850, commission: 170, driverEarning: 680, status: 'completed', time: '45 min ago' },
]

export const mockRateCards = [
  { id: 'RC1', category: 'Hatchback', rideType: 'one_way',    perKm: 12, perMin: 1.5, minFare: 60,  returnRate: null, updatedBy: 'Aryan Mehta', updatedAt: '1 Jun 2026' },
  { id: 'RC2', category: 'Sedan',     rideType: 'one_way',    perKm: 15, perMin: 2.0, minFare: 80,  returnRate: null, updatedBy: 'Aryan Mehta', updatedAt: '1 Jun 2026' },
  { id: 'RC3', category: 'SUV',       rideType: 'one_way',    perKm: 20, perMin: 2.5, minFare: 120, returnRate: null, updatedBy: 'Aryan Mehta', updatedAt: '1 Jun 2026' },
  { id: 'RC4', category: 'Sedan',     rideType: 'round_trip', perKm: 13, perMin: 1.8, minFare: 200, returnRate: 8,   updatedBy: 'Aryan Mehta', updatedAt: '15 May 2026' },
]

export const mockSystemConfig = [
  { key: 'dispatch.radius_km',            group: 'Dispatch',     description: 'Search radius for driver matching',         value: '5',     default: '5',     type: 'number'  as const },
  { key: 'dispatch.max_wait_seconds',     group: 'Dispatch',     description: 'Seconds before request auto-expires',       value: '20',    default: '20',    type: 'number'  as const },
  { key: 'dispatch.max_retries',          group: 'Dispatch',     description: 'Times to retry matching before cancelling',  value: '3',     default: '3',     type: 'number'  as const },
  { key: 'pricing.surge_enabled',         group: 'Pricing',      description: 'Enable surge pricing during peak hours',     value: 'true',  default: 'true',  type: 'boolean' as const },
  { key: 'pricing.surge_multiplier_max',  group: 'Pricing',      description: 'Maximum surge multiplier allowed',           value: '2.5',   default: '2.0',   type: 'decimal' as const },
  { key: 'wallet.min_balance',            group: 'Wallet',       description: 'Minimum driver compliance deposit',          value: '500',   default: '500',   type: 'number'  as const },
  { key: 'wallet.low_balance_alert',      group: 'Wallet',       description: 'Alert threshold for low balance warning',    value: '200',   default: '250',   type: 'number'  as const },
  { key: 'otp.expiry_seconds',            group: 'OTP',          description: 'OTP validity window in seconds',             value: '300',   default: '300',   type: 'number'  as const },
  { key: 'otp.max_attempts',              group: 'OTP',          description: 'Max failed OTP attempts before lockout',     value: '5',     default: '5',     type: 'number'  as const },
  { key: 'payments.auto_settle_enabled',  group: 'Payments',     description: 'Auto-settle driver earnings daily',          value: 'true',  default: 'true',  type: 'boolean' as const },
  { key: 'notifications.sms_enabled',     group: 'Notifications',description: 'Send SMS notifications to riders',          value: 'true',  default: 'true',  type: 'boolean' as const },
  { key: 'notifications.push_enabled',    group: 'Notifications',description: 'Send push notifications',                   value: 'true',  default: 'true',  type: 'boolean' as const },
]
