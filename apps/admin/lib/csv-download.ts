import api from './api'

export interface CsvDownload {
  filename: string
  rows: number | null
}

/** Pulls a server-built CSV through the authenticated axios instance (a plain link would not carry the token) and saves it. */
export async function downloadCsv(path: string, params: Record<string, string | undefined> = {}): Promise<CsvDownload> {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) if (v) clean[k] = v
  try {
    const res = await api.get<Blob>(path, { params: clean, responseType: 'blob' })
    const filename = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? 'ocar-export.csv'
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    const n = Number(res.headers['x-export-rows'])
    return { filename, rows: Number.isFinite(n) && res.headers['x-export-rows'] != null ? n : null }
  } catch (err) {
    throw new Error(await exportErrorMessage(err))
  }
}

// A blob response hides the JSON error body, so read it back to show the server's own words (too many rows, throttled).
async function exportErrorMessage(err: unknown): Promise<string> {
  const res = (err as { response?: { status?: number; data?: unknown } }).response
  if (res?.status === 429) return 'Too many exports. Wait a minute and try again.'
  if (res?.status === 403) return 'Your role cannot export this list.'
  try {
    if (res?.data instanceof Blob) {
      const body = JSON.parse(await res.data.text()) as { error?: string }
      if (body.error) return body.error
    }
  } catch { /* fall through */ }
  return 'Export failed. Try again.'
}
