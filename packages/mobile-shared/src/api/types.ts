export type ApiError = {
  error: string
  code: string
  requestId?: string
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
}
