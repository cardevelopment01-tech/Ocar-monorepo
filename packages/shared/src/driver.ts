// Single source of truth for how a rider sees their driver: used by the user web app and the
// rider mobile app so every screen (live ride, chat, rate, receipt, history) reads the same.

export type DriverIdentityInput = {
  name: string | null
  rating: string | number | null
  totalTrips: number | null
  verified: boolean | null
  vehicleColor: string | null
  vehicleBrand: string | null
  vehicleModel: string | null
  vehicleName: string | null
  plate: string | null
}

export type DriverIdentityView = {
  name: string
  firstName: string
  initials: string
  /** null until the driver has completed trips: rating_avg defaults to 5.00 for brand-new drivers */
  ratingText: string | null
  tripsText: string
  verified: boolean
  /** "Pearl White Maruti Dzire" -- colour first, like Uber's "Black Honda Shine" */
  vehicleLine: string
  /** brand + model without colour, for tight spaces */
  vehicleShort: string
  swatch: string | null
  plate: string | null
}

// Hue words drivers actually type into the vehicle-colour field. Unknown names get no swatch
// (text only) rather than a wrong dot.
const HUES: Record<string, string> = {
  white: '#FFFFFF', black: '#111111', silver: '#C0C0C0', grey: '#808080', gray: '#808080',
  red: '#D32F2F', maroon: '#7B1E2B', blue: '#1E63D6', green: '#2E7D32', yellow: '#F4C20D',
  orange: '#F57C00', brown: '#6D4C41', beige: '#D9C7A3', gold: '#C9A227', golden: '#C9A227',
  bronze: '#8C6A3C', purple: '#6A3FA0', pink: '#E86A9A', cream: '#F2E8CF', teal: '#0E8C8C',
}

export function carColorHex(name: string | null | undefined): string | null {
  if (!name) return null
  const words = name.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  // last word wins: "light blue", "pearl white", "metallic grey" are all keyed by the hue word
  for (let i = words.length - 1; i >= 0; i--) {
    const hex = HUES[words[i]!]
    if (hex) return hex
  }
  return null
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0]![0]!
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : ''
  return (first + last).toUpperCase()
}

export function driverIdentity(d: DriverIdentityInput): DriverIdentityView {
  const name = d.name?.trim() || 'Your driver'
  const trips = d.totalTrips ?? 0
  const rating = Number(d.rating)
  const color = d.vehicleColor?.trim() || null
  const vehicleShort = [d.vehicleBrand, d.vehicleModel].filter(Boolean).join(' ') || d.vehicleName?.trim() || ''
  return {
    name,
    firstName: name.split(/\s+/)[0]!,
    initials: d.name?.trim() ? initialsOf(d.name) : '?',
    ratingText: trips > 0 && rating > 0 ? rating.toFixed(1) : null,
    tripsText: trips > 0 ? `${trips.toLocaleString('en-IN')} ${trips === 1 ? 'trip' : 'trips'}` : 'Newly joined',
    verified: d.verified === true,
    vehicleLine: [color, vehicleShort].filter(Boolean).join(' ') || 'Vehicle',
    vehicleShort: vehicleShort || 'Vehicle',
    swatch: carColorHex(color),
    plate: d.plate?.trim() || null,
  }
}
