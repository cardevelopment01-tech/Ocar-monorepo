/** What the phone field should hold after any edit: ten digits, no country code. People paste "+91 98765 43210", "098765 43210" or
 *  "9876543210"; all of them become "9876543210". Anything shorter than 11 digits is only stripped of non-digits. */
export function normalizeIndianPhoneInput(text: string): string {
  let d = text.replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
  else if (d.length > 10 && d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}

/** 98765 43210: a space after the fifth digit, the way people read a mobile number aloud. */
export function formatPhoneDisplay(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits
}
