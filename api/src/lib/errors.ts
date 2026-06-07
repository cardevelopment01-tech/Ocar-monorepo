import { AppErrors } from '@/constants/errors'

type AppErrorEntry = (typeof AppErrors)[keyof typeof AppErrors]

export function createHttpError(
  entry: AppErrorEntry
): Error & { httpStatus: number; appCode: string } {
  const err = new Error(entry.message) as Error & { httpStatus: number; appCode: string }
  err.httpStatus = entry.httpStatus
  err.appCode = entry.code
  return err
}

export function httpError(
  httpStatus: number,
  message: string,
  appCode: string
): Error & { httpStatus: number; appCode: string } {
  const err = new Error(message) as Error & { httpStatus: number; appCode: string }
  err.httpStatus = httpStatus
  err.appCode = appCode
  return err
}
