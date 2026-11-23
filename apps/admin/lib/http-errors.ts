import axios from 'axios'

/** Server error message from an axios error response, or a fallback if the
 * request failed for any other reason (network error, non-axios throw, or
 * the server didn't send one). Matches errorMiddleware.ts's response shape:
 * { error, code, requestId }. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback
  if (!err.response) return "Can't reach the server. Check your connection and try again."
  const { status, data } = err.response
  if (status >= 500) return 'The server hit a problem. Try again in a moment, and tell engineering if it keeps happening.'
  const field = data?.fields ? (Object.values(data.fields).flat() as string[])[0] : undefined
  if (field) return field
  // The generic throttle (RATE_LIMIT_EXCEEDED) is worded here; a 429 that comes with its own message ("Wait 42 seconds before resending") is shown as written.
  if (status === 429) return data?.error && data.code && data.code !== 'RATE_LIMIT_EXCEEDED' ? data.error : 'Too many attempts. Wait a moment and try again.'
  return data?.error && data.error !== 'Validation failed' ? data.error : fallback
}

/** Server error code from an axios error response (e.g. 'BOUNDARY_CHANGED',
 * 'DOC_CHANGED'), for branching on a specific failure instead of just
 * displaying the message. */
export function extractErrorCode(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? err.response?.data?.code : undefined
}
