import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import * as controller from './admin.controller'

const router: IRouter = Router()

// All admin routes require a valid admin JWT
router.use(authenticate())

// ─── Drivers ──────────────────────────────────────────────────────────────────
router.get('/drivers',               controller.getDrivers)
router.get('/drivers/:id',           controller.getDriver)
router.patch('/drivers/:id/status',  controller.updateDriverStatus)

// ─── Vehicle categories ───────────────────────────────────────────────────────
router.get('/vehicles/categories',       requireAdmin('super_admin', 'ops_admin'), controller.getCategories)
router.post('/vehicles/categories',      requireAdmin('super_admin', 'ops_admin'), controller.postCategory)
router.patch('/vehicles/categories/:id', requireAdmin('super_admin', 'ops_admin'), controller.patchCategory)

// ─── Vehicle brands ───────────────────────────────────────────────────────────
router.get('/vehicles/brands',       requireAdmin('super_admin', 'ops_admin'), controller.getBrands)
router.post('/vehicles/brands',      requireAdmin('super_admin', 'ops_admin'), controller.postBrand)
router.patch('/vehicles/brands/:id', requireAdmin('super_admin', 'ops_admin'), controller.patchBrand)

// ─── Vehicle models ───────────────────────────────────────────────────────────
router.get('/vehicles/models',       requireAdmin('super_admin', 'ops_admin'), controller.getModels)
router.post('/vehicles/models',      requireAdmin('super_admin', 'ops_admin'), controller.postModel)
router.patch('/vehicles/models/:id', requireAdmin('super_admin', 'ops_admin'), controller.patchModel)

// ─── Fleet ────────────────────────────────────────────────────────────────────
router.get('/vehicles/fleet',                                    requireAdmin('super_admin', 'ops_admin'), controller.getFleet)
router.patch('/vehicles/fleet/:vehicleId/blacklist',             requireAdmin('super_admin', 'ops_admin'), controller.blacklistVehicle)
router.patch('/vehicles/fleet/:vehicleId/unblacklist',           requireAdmin('super_admin', 'ops_admin'), controller.unblacklistVehicle)

// ─── Vehicle documents (static segments BEFORE :docId) ───────────────────────
router.get('/vehicles/documents/pending',       requireAdmin('super_admin', 'ops_admin'), controller.getPendingVehicleDocs)
router.get('/vehicles/documents/expiring',      requireAdmin('super_admin', 'ops_admin'), controller.getExpiringDocs)
router.patch('/vehicles/documents/:docId/approve', requireAdmin('super_admin', 'ops_admin'), controller.approveVehicleDoc)
router.patch('/vehicles/documents/:docId/reject',  requireAdmin('super_admin', 'ops_admin'), controller.rejectVehicleDoc)

// ─── Geo / Cities ─────────────────────────────────────────────────────────────
router.get('/geo/cities',       requireAdmin('super_admin', 'ops_admin'), controller.getAdminCities)
router.post('/geo/cities',      requireAdmin('super_admin', 'ops_admin'), controller.postAdminCity)
router.patch('/geo/cities/:id', requireAdmin('super_admin', 'ops_admin'), controller.patchAdminCity)

export default router
