import { IRouter, Router } from 'express'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import { requireDriver } from '@/middleware/role.middleware'
import * as controller from './drivers.controller'
import * as verificationController from './driver-verification.controller'
import {
  updateProfileSchema,
  personalInfoSchema,
  vehicleInfoSchema,
  identityDocumentSchema,
  identityUploadInitSchema,
  identityUploadCompleteSchema,
  vehicleUploadInitSchema,
  vehicleUploadCompleteSchema,
  verificationUploadInitSchema,
  verificationSubmitSchema,
} from './drivers.validator'

const router: IRouter = Router()
const guard = [authenticate(), requireDriver()]
// Daily verification is a pre-shift check for drivers who are already fully
// onboarded — unlike the onboarding routes above, pending/suspended/banned
// drivers shouldn't be able to submit it.
const activeGuard = [authenticate(), requireDriver('active')]

router.get('/me', ...guard, controller.getMe)
router.patch('/me', ...guard, validate(updateProfileSchema), controller.updateMe)

router.get('/onboarding/personal-info',  ...guard, controller.getPersonalInfo)
router.post('/onboarding/personal-info', ...guard, validate(personalInfoSchema), controller.savePersonalInfo)

router.get('/onboarding/vehicle-info',  ...guard, controller.getVehicleInfo)
router.post('/onboarding/vehicle-info', ...guard, validate(vehicleInfoSchema), controller.saveVehicleInfo)

router.post('/onboarding/documents/identity',
  ...guard, validate(identityDocumentSchema), controller.saveIdentityDocuments)

router.post('/onboarding/documents/upload-init',
  ...guard, validate(identityUploadInitSchema), controller.uploadDocumentInit)
router.post('/onboarding/documents/upload-complete',
  ...guard, validate(identityUploadCompleteSchema), controller.uploadDocumentComplete)

router.post('/onboarding/documents/vehicle-upload-init',
  ...guard, validate(vehicleUploadInitSchema), controller.uploadVehicleDocumentInit)
router.post('/onboarding/documents/vehicle-upload-complete',
  ...guard, validate(vehicleUploadCompleteSchema), controller.uploadVehicleDocumentComplete)

router.get('/onboarding/documents/status', ...guard, controller.getDocumentStatus)

router.post('/onboarding/submit', ...guard, controller.submitApplication)

router.get('/daily-verification/status', ...activeGuard, verificationController.getVerificationStatus)
router.post('/daily-verification/upload-init',
  ...activeGuard, validate(verificationUploadInitSchema), verificationController.initVerificationUpload)
router.post('/daily-verification',
  ...activeGuard, validate(verificationSubmitSchema), verificationController.submitVerification)

export default router
