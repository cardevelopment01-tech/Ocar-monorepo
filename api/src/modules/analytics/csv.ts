// CSV writer for Reports exports (CEO E6). Text cells that start with a formula trigger
// (= + - @ tab CR) are prefixed with a single quote so Excel/Sheets treat them as text.
// Numbers are never prefixed (a negative number is a number, not a formula).

const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s: string
  if (typeof value === 'number') {
    s = Number.isFinite(value) ? String(value) : ''
  } else {
    s = String(value)
    if (FORMULA_START.test(s)) s = `'${s}`
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  // UTF-8 BOM so Excel renders the rupee sign and Odia names correctly.
  return '﻿' + lines.join('\r\n') + '\r\n'
}
