// Single source of truth for the business identity shown on the public site
// (footer, Contact, About, and every policy page). PayU's website review checks
// that these details are real and consistent across pages, so edit them here
// only. Every value in square brackets is a placeholder the business must fill
// in before the site is submitted for payment-gateway approval.
export const COMPANY = {
  brand: 'Ocar',
  legalName: 'OD CAR RENTALS PRIVATE LIMITED',
  siteUrl: 'https://ocarindia.com',
  supportEmail: 'support@ocarindia.com',
  supportPhone: '+91 95565 37170',
  supportHours: '7:00 AM to 10:00 PM IST, every day',
  address: {
    line1: 'LIG-873 K-4, Kalinga Vihar, Patrapada',
    city: 'Bhubaneswar, Khordha',
    state: 'Odisha',
    pincode: '751019',
    country: 'India',
  },
  gstin: '21AAFCO1215R1ZH',
  grievanceOfficer: {
    name: '[Add Grievance Officer name]',
    email: 'grievance@ocarindia.com',
  },
  serviceCities: ['Bhubaneswar', 'Cuttack', 'Puri'],
} as const

// The legal pages were drafted from Ocar's real data practices but have not
// been reviewed by counsel. Flip to false only once a lawyer has signed off.
export const LEGAL_DRAFT_NOTICE = true

export const LEGAL_LAST_UPDATED = '25 September 2026'

export function formatAddress(): string {
  const a = COMPANY.address
  return `${a.line1}, ${a.city}, ${a.state} ${a.pincode}, ${a.country}`
}

// "Bhubaneswar, Cuttack and Puri"
export const CITIES_TEXT = COMPANY.serviceCities.join(', ').replace(/, ([^,]*)$/, ' and $1')
