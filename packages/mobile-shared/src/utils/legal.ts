// The rider web app (apps/user) is the single hosted source for Terms &
// Privacy content -- both native apps link out to it instead of duplicating
// the legal text. Override via EXPO_PUBLIC_LEGAL_BASE_URL per environment;
// falls back to the domain already assumed elsewhere in this codebase
// (apps/driver's ocar.in links, support@ocar.in mailto).
const LEGAL_BASE_URL = process.env['EXPO_PUBLIC_LEGAL_BASE_URL'] ?? 'https://ocar.in'

export const TERMS_URL = `${LEGAL_BASE_URL}/legal/terms`
export const PRIVACY_URL = `${LEGAL_BASE_URL}/legal/privacy`
