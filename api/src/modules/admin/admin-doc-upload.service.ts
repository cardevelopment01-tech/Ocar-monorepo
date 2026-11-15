import type { Express } from 'express'
import { z } from 'zod'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { uploadFile, getPresignedUrl } from '@/lib/storage'
import { recordAuditLog } from '@/lib/audit-log'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import * as driverRepo from '@/modules/drivers/drivers.repository'
import { submitIfCompleteByAdmin } from '@/modules/drivers/drivers.service'
import { IDENTITY_DOC_TYPES, VEHICLE_DOC_TYPES } from '@/modules/drivers/drivers.validator'
import * as repo from './admin.repository'
import { afterDocChange, docLabel, validateVerifiedExpiry } from './admin.service'

export const MAX_ADMIN_UPLOAD_BYTES = 10 * 1024 * 1024

const bool = z.preprocess((v) => v === true || v === 'true', z.boolean())

// Multipart fields arrive as strings; an empty string means "not sent".
const opt = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional())

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const adminDocUploadSchema = z
  .object({
    kind: z.enum(['driver', 'vehicle']),
    doc_type: z.string(),
    reason: z.string().trim().min(5).max(300),
    ticket_ref: opt(z.string().trim().max(80)),
    valid_until: opt(isoDate),
    doc_number: opt(z.string().trim().max(80)),
    approve: bool,
    verified_valid_until: opt(isoDate),
    seen_updated_at: opt(z.string()),
    confirm_reference_selfie: bool,
  })
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = v.kind === 'driver' ? IDENTITY_DOC_TYPES : VEHICLE_DOC_TYPES
    if (!allowed.includes(v.doc_type)) {
      ctx.addIssue({ code: 'custom', path: ['doc_type'], message: 'Unknown document type' })
    }
  })
export type AdminDocUploadInput = z.infer<typeof adminDocUploadSchema>

// The declared MIME type is client text; trust the file's own first bytes.
export function sniffMime(buf: Buffer): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 4 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png'
  if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  return null
}
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' } as const

export async function uploadDriverDocumentForDriver(
  driverId: bigint,
  adminId: bigint,
  file: Express.Multer.File | undefined,
  input: AdminDocUploadInput,
  ipAddress: string | null,
): Promise<{ kind: string; doc_type: string; status: string; file_url: string; driver_status: string; submitted: boolean }> {
  if (!file) throw httpError(422, 'Choose a file to upload.', 'VALIDATION_ERROR')
  if (file.size > MAX_ADMIN_UPLOAD_BYTES) throw httpError(422, 'File size exceeds 10MB limit', 'FILE_TOO_LARGE')
  const mime = sniffMime(file.buffer)
  if (!mime) throw httpError(422, 'Only JPG, PNG or PDF files are allowed.', 'VALIDATION_ERROR')

  const driver = await driverRepo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)
  if (driver.status === 'banned' || driver.status === 'deleted') {
    throw httpError(422, 'Documents cannot be changed for a banned or deleted driver.', 'DRIVER_NOT_EDITABLE')
  }
  if (input.doc_type === 'profile_photo' && !input.confirm_reference_selfie) {
    throw httpError(422, "Confirm that this photo becomes the driver's reference selfie.", 'CONFIRMATION_REQUIRED')
  }

  const isVehicle = input.kind === 'vehicle'
  const vehicle = isVehicle ? await driverRepo.findVehicleByDriverId(driverId) : null
  if (isVehicle && !vehicle) throw httpError(422, "Add the driver's vehicle details first.", 'STEP_NOT_COMPLETE')

  // Replacing an existing document must be against the version the admin saw.
  const existing = isVehicle
    ? (await driverRepo.findVehicleDocuments(vehicle!.id)).find((d) => d.doc_type === input.doc_type)
    : (await driverRepo.findDriverDocuments(driverId)).find((d) => d.doc_type === input.doc_type)
  if (existing) {
    if (!input.seen_updated_at) throw httpError(400, 'Missing document version. Refresh and try again.', 'VALIDATION_ERROR')
    if (new Date(existing.updated_at).getTime() !== new Date(input.seen_updated_at).getTime()) {
      throw httpError(409, 'This document was modified since you last viewed it. Refresh and try again.', 'DOC_CHANGED')
    }
  }

  // Fail before touching S3 if an approve would be refused for its expiry.
  const verifiedExpiry = input.approve ? validateVerifiedExpiry(input.doc_type, input.verified_valid_until ?? '') : null

  const folder = isVehicle ? `drivers/${driverId}/vehicle/${input.doc_type}` : `drivers/${driverId}/${input.doc_type}`
  file.mimetype = mime
  file.originalname = `upload${EXT[mime]}`
  const fileUrl = await uploadFile(file, folder)

  const validUntil = input.valid_until ? new Date(input.valid_until) : undefined
  const doc = isVehicle
    ? await driverRepo.upsertVehicleDocument(vehicle!.id, input.doc_type, fileUrl, input.doc_number, validUntil, adminId)
    : await driverRepo.upsertDriverDocument(driverId, input.doc_type, fileUrl, undefined, validUntil, adminId)
  if (input.doc_type === 'profile_photo') await driverRepo.setReferenceSelfie(driverId, fileUrl)

  let status: string = doc.status
  if (input.approve) {
    const seen = new Date(doc.updated_at).toISOString()
    const approved = isVehicle
      ? await repo.approveVehicleDoc(BigInt(doc.id), adminId, verifiedExpiry, seen)
      : await repo.approveDriverDoc(BigInt(doc.id), adminId, verifiedExpiry, seen)
    if (approved) status = 'approved'
  }

  await recordAuditLog({
    adminId,
    action: 'driver_documents.admin_upload',
    targetTable: isVehicle ? 'driver_vehicle_documents' : 'driver_documents',
    targetId: BigInt(doc.id),
    beforeState: existing ? { file_url: existing.file_url, status: existing.status } : null,
    afterState: { driver_id: String(driverId), doc_type: input.doc_type, file_url: fileUrl, status },
    reason: input.ticket_ref ? `${input.reason} [${input.ticket_ref}]` : input.reason,
    ipAddress,
  })

  let submitted = false
  try {
    submitted = await submitIfCompleteByAdmin(driverId, adminId)
  } catch {
    // The document is saved; the driver can still submit the application themselves.
  }
  await afterDocChange(driverId, adminId, () =>
    notifyOwner({
      ownerType: 'driver',
      ownerId: driverId,
      type: 'document_uploaded_by_admin',
      title: 'Documents updated by Ocar support',
      body: `Our team updated your ${docLabel(input.doc_type)}. Open Documents to check it.`,
      payload: { path: '/profile/documents' },
    }),
  )

  const after = await driverRepo.findDriverById(driverId)
  return {
    kind: input.kind,
    doc_type: input.doc_type,
    status,
    file_url: await getPresignedUrl(fileUrl),
    driver_status: after?.status ?? driver.status,
    submitted,
  }
}
