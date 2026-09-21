const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Manual base64url decode instead of atob/Buffer -- Hermes doesn't guarantee either is
// globally available, and this only ever needs to read a JWT's exp claim.
function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  let output = ''
  let buffer = 0
  let bits = 0
  for (const char of normalized) {
    const value = BASE64_CHARS.indexOf(char)
    if (value === -1) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }
  return decodeURIComponent(
    output
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  )
}

export function tokenExpiresSoon(token: string, skewSeconds = 60): boolean {
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    const decoded = JSON.parse(base64UrlDecode(payload)) as { exp?: number }
    return typeof decoded.exp === 'number' && decoded.exp - Math.floor(Date.now() / 1000) <= skewSeconds
  } catch {
    return false
  }
}
