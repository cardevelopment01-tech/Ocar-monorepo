// Deliberately loose: one @ with something on each side and a dot in the domain. It only catches obvious typos before
// a round trip; the server has the final say.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isPlausibleEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

export const EMAIL_ERROR = 'Enter a valid email address, or leave it blank.'
