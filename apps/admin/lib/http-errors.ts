import axios from 'axios'

/** Server error message from an axios error response, or a fallback if the
 * request failed for any other reason (network error, non-axios throw, or
 * the server didn't send one). Matches errorMiddleware.ts's response shape:
 * { error, code, requestId }. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  return axios.isAxiosError(err) ? (err.response?.data?.error ?? fallback) : fallback
}

/** Server error code from an axios error response (e.g. 'BOUNDARY_CHANGED',
 * 'DOC_CHANGED'), for branching on a specific failure instead of just
 * displaying the message. */
export function extractErrorCode(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? err.response?.data?.code : undefined
}
