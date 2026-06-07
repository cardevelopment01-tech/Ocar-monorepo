import { IRouter, Router } from 'express'
import multer from 'multer'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import { requireDriver } from '@/middleware/role.middleware'
import * as controller from './drivers.controller'
import {
  personalInfoSchema,
  vehicleInfoSchema,
  identityDocumentSchema,
  identityUploadSchema,
  vehicleUploadSchema,
} from './drivers.validator'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
})

const router: IRouter = Router()
const guard = [authenticate(), requireDriver()]

router.get('/me', ...guard, controller.getMe)

router.get('/onboarding/personal-info',  ...guard, controller.getPersonalInfo)
router.post('/onboarding/personal-info', ...guard, validate(personalInfoSchema), controller.savePersonalInfo)

router.get('/onboarding/vehicle-info',  ...guard, controller.getVehicleInfo)
router.post('/onboarding/vehicle-info', ...guard, validate(vehicleInfoSchema), controller.saveVehicleInfo)

router.post('/onboarding/documents/identity',
  ...guard, validate(identityDocumentSchema), controller.saveIdentityDocuments)

router.post('/onboarding/documents/upload',
  ...guard, upload.single('file'), validate(identityUploadSchema), controller.uploadDocument)

router.post('/onboarding/documents/vehicle-upload',
  ...guard, upload.single('file'), validate(vehicleUploadSchema), controller.uploadVehicleDocument)

router.get('/onboarding/documents/status', ...guard, controller.getDocumentStatus)

router.post('/onboarding/submit', ...guard, controller.submitApplication)

export default router
