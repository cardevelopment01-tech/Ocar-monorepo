// The rider web app (apps/user) is the single hosted source for Terms &
// Privacy content -- every other surface (this app, driver, both mobile
// apps) links out to it instead of duplicating the legal text 5x. Override
// via NEXT_PUBLIC_LEGAL_BASE_URL per environment; falls back to the domain
// already assumed elsewhere in this codebase (apps/driver's old ocar.in
// links, support@ocar.in mailto).
const LEGAL_BASE_URL = process.env['NEXT_PUBLIC_LEGAL_BASE_URL'] || 'https://ocarindia.com'

export const TERMS_URL = `${LEGAL_BASE_URL}/legal/terms`
export const PRIVACY_URL = `${LEGAL_BASE_URL}/legal/privacy`
