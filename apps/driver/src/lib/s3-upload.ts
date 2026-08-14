import axios from 'axios'

// Plain axios (not the app's `api` instance) -- a presigned S3 URL must not
// carry our Authorization header or get prefixed with our API's baseURL.
// A v4-signed PUT URL is valid for its whole expiry window and can be
// retried against the *same* URL as many times as needed -- only request a
// fresh one (caller's job) if this throws after retries exhaust, which
// usually means the URL actually expired.
export async function putToS3WithRetry(uploadUrl: string, file: File, attempts = 3): Promise<void> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      await axios.put(uploadUrl, file, {
        headers: { 'Content-Type': file.type },
        timeout: 60000,
      })
      return
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i))
      }
    }
  }
  throw lastErr
}
