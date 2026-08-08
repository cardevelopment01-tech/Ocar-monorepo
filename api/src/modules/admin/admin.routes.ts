import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import * as controller from './admin.controller'

const router: IRouter = Router()

// All admin routes require a valid admin JWT
router.use(authenticate())
router.use(requireAdmin())

// ─── Dashboard stats ─────────────────────────────────────────────────────────
router.get('/stats', controller.getAdminStats)

// ─── Admin accounts ───────────────────────────────────────────────────────────
router.get('/admins', requireAdmin('super_admin'), controller.getAdminAccounts)
router.patch('/admins/:id/status', requireAdmin('super_admin'), controller.patchAdminStatus)

// ─── Live map ─────────────────────────────────────────────────────────────────
router.get('/sessions/active', controller.getAdminActiveSessions)

// ─── Drivers ──────────────────────────────────────────────────────────────────
router.get('/drivers',               controller.getDrivers)
router.get('/drivers/:id',           controller.getDriver)
router.patch('/drivers/:id/status',  requireAdmin('super_admin', 'ops_admin'), controller.updateDriverStatus)
router.patch('/drivers/:id/profile', requireAdmin('super_admin', 'ops_admin'), controller.updateDriverProfile)
router.patch('/drivers/:id/vehicle', requireAdmin('super_admin', 'ops_admin'), controller.updateDriverVehicle)
router.get('/drivers/:id/rides',     requireAdmin('super_admin', 'ops_admin'), controller.getDriverRides)
router.get('/drivers/:id/payments',  requireAdmin('super_admin', 'ops_admin'), controller.getDriverPayments)
router.get('/drivers/:id/audit-log', requireAdmin('super_admin', 'ops_admin'), controller.getDriverAuditLog)

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

// ─── Driver documents ─────────────────────────────────────────────────────────
router.patch('/drivers/documents/:docId/approve', requireAdmin('super_admin', 'ops_admin'), controller.approveDriverDoc)
router.patch('/drivers/documents/:docId/reject',  requireAdmin('super_admin', 'ops_admin'), controller.rejectDriverDoc)

// ─── Vehicle documents (static segments BEFORE :docId) ───────────────────────
router.get('/vehicles/documents/pending',       requireAdmin('super_admin', 'ops_admin'), controller.getPendingVehicleDocs)
router.get('/vehicles/documents/expiring',      requireAdmin('super_admin', 'ops_admin'), controller.getExpiringDocs)
router.patch('/vehicles/documents/:docId/approve', requireAdmin('super_admin', 'ops_admin'), controller.approveVehicleDoc)
router.patch('/vehicles/documents/:docId/reject',  requireAdmin('super_admin', 'ops_admin'), controller.rejectVehicleDoc)

// ─── Pricing ──────────────────────────────────────────────────────────────────
router.get('/pricing/rate-cards',              requireAdmin('super_admin', 'ops_admin'), controller.getAdminRateCards)
router.post('/pricing/rate-cards',             requireAdmin('super_admin', 'ops_admin'), controller.postAdminRateCard)
router.get('/pricing/rate-cards/history',      requireAdmin('super_admin', 'ops_admin'), controller.getAdminRateCardHistory)
router.get('/pricing/surge',                   requireAdmin('super_admin', 'ops_admin'), controller.getAdminSurgeEvents)
router.post('/pricing/surge',                  requireAdmin('super_admin', 'ops_admin'), controller.postAdminSurgeEvent)
router.patch('/pricing/surge/:id/cancel',      requireAdmin('super_admin', 'ops_admin'), controller.cancelAdminSurgeEvent)
router.get('/pricing/rental-packages',         requireAdmin('super_admin', 'ops_admin'), controller.getAdminRentalPackages)
router.post('/pricing/rental-packages',        requireAdmin('super_admin', 'ops_admin'), controller.postAdminRentalPackage)
router.patch('/pricing/rental-packages/:id',   requireAdmin('super_admin', 'ops_admin'), controller.patchAdminRentalPackage)
router.delete('/pricing/rental-packages/:id',  requireAdmin('super_admin', 'ops_admin'), controller.deleteAdminRentalPackage)

// ─── Geo / Cities ─────────────────────────────────────────────────────────────
router.get('/geo/cities',       requireAdmin('super_admin', 'ops_admin'), controller.getAdminCities)
router.post('/geo/cities',      requireAdmin('super_admin', 'ops_admin'), controller.postAdminCity)
router.patch('/geo/cities/:id', requireAdmin('super_admin', 'ops_admin'), controller.patchAdminCity)

// ─── Package tiers / driver package wallet (city billing_mode = 'package') ──
router.get('/package-tiers',       requireAdmin('super_admin', 'ops_admin'), controller.getPackageTiers)
router.post('/package-tiers',      requireAdmin('super_admin', 'ops_admin'), controller.postPackageTier)
router.patch('/package-tiers/:id', requireAdmin('super_admin', 'ops_admin'), controller.patchPackageTier)
router.get('/drivers/:id/package',           requireAdmin('super_admin', 'ops_admin'), controller.getDriverPackageDetail)
// Money-moving — super_admin only, unlike the ops_admin-reachable read/CRUD above.
router.patch('/drivers/:id/package/balance', requireAdmin('super_admin'), controller.patchDriverPackageBalance)

// ─── Safety — SOS ─────────────────────────────────────────────────────────────
router.get('/safety/sos',                    controller.getAdminSosAlerts)
router.patch('/safety/sos/:id/acknowledge',  requireAdmin('super_admin', 'ops_admin', 'support_admin'), controller.acknowledgeAdminSos)
router.patch('/safety/sos/:id/resolve',      requireAdmin('super_admin', 'ops_admin', 'support_admin'), controller.resolveAdminSos)

// ─── Safety — Disputes ────────────────────────────────────────────────────────
router.get('/safety/disputes',           controller.getAdminDisputes)
router.get('/safety/disputes/:id',       controller.getAdminDispute)
router.get('/safety/disputes/:id/trip-replay', controller.getAdminDisputeTripReplay)
router.patch('/safety/disputes/:id/assign',  requireAdmin('super_admin', 'support_admin'), controller.assignAdminDispute)
router.patch('/safety/disputes/:id/resolve', requireAdmin('super_admin', 'support_admin'), controller.resolveAdminDispute)

// ─── Rides ────────────────────────────────────────────────────────────────────
router.get('/rides', requireAdmin('super_admin', 'ops_admin', 'support_admin'), controller.getAdminRides)
router.get('/rides/upcoming', requireAdmin('super_admin', 'ops_admin', 'support_admin'), controller.getUpcomingScheduledRides)
router.get('/rides/:id', requireAdmin('super_admin', 'ops_admin', 'support_admin'), controller.getAdminRideById)
router.post('/rides/:id/force-resolve', requireAdmin('super_admin', 'ops_admin'), controller.forceResolveAdminRide)

// ─── Users ────────────────────────────────────────────────────────────────────
router.get('/users',                controller.getAdminUsers)
router.patch('/users/:id/status',   requireAdmin('super_admin', 'ops_admin'), controller.patchAdminUserStatus)

// ─── Payments ─────────────────────────────────────────────────────────────────
router.get('/payments', requireAdmin('super_admin', 'finance_admin'), controller.getAdminPayments)

export default router
