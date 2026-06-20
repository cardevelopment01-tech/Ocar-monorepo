import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import ProtectedRoute from '@/components/ProtectedRoute'
import BottomNav from '@/components/ui/BottomNav'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import Earnings from '@/pages/Earnings'
import Wallet from '@/pages/Wallet'
import Profile from '@/pages/Profile'
import IncomingRequest from '@/pages/ActiveRide/IncomingRequest'
import NavigateToPickup from '@/pages/ActiveRide/NavigateToPickup'
import OTPVerify from '@/pages/ActiveRide/OTPVerify'
import TripInProgress from '@/pages/ActiveRide/TripInProgress'
import TripEnd from '@/pages/ActiveRide/TripEnd'
import ModeSelection from '@/pages/GoOnline/ModeSelection'
import StandardConfirm from '@/pages/GoOnline/StandardConfirm'
import ReturnCabSetup from '@/pages/GoOnline/ReturnCabSetup'
import PersonalDetails from '@/pages/Onboarding/PersonalDetails'
import Documents from '@/pages/Onboarding/Documents'
import VehicleRegistration from '@/pages/Onboarding/VehicleRegistration'
import VehicleDocuments from '@/pages/Onboarding/VehicleDocuments'
import ReferenceSelfie from '@/pages/Onboarding/ReferenceSelfie'
import PendingReview from '@/pages/Onboarding/PendingReview'
import { useAuthStore } from '@/store/useAuthStore'
import api from '@/lib/api'
import type { DriverProfile } from '@/store/useAuthStore'
import { DEMO_MODE } from '@/lib/demo'
import DemoBlock from '@/components/ui/DemoBlock'

export default function App() {
  const location = useLocation()
  const { isAuthenticated, updateDriver, clearAuth } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) return
    api.get<{ driver: DriverProfile }>('/api/v1/drivers/me')
      .then(res => updateDriver({
        status: res.data.driver.status,
        onboarding_step: res.data.driver.onboarding_step,
        full_name: res.data.driver.full_name,
      }))
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 401) clearAuth()
      })
  }, [])

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.20, ease: [0.22, 1, 0.36, 1] }}
        >
          <Routes location={location}>
            {/* Auth */}
            <Route path="/login" element={<Login />} />

            {/* Main tabs — approved drivers only */}
            <Route path="/" element={
              <ProtectedRoute requireApproved><Home /></ProtectedRoute>
            } />
            <Route path="/earnings" element={
              <ProtectedRoute requireApproved>
                {DEMO_MODE ? <DemoBlock feature="Earnings" /> : <Earnings />}
              </ProtectedRoute>
            } />
            <Route path="/wallet" element={
              <ProtectedRoute requireApproved>
                {DEMO_MODE ? <DemoBlock feature="Driver Wallet" /> : <Wallet />}
              </ProtectedRoute>
            } />
            <Route path="/profile" element={
              <ProtectedRoute requireApproved><Profile /></ProtectedRoute>
            } />

            {/* Go online flow */}
            <Route path="/go-online/mode" element={
              <ProtectedRoute requireApproved><ModeSelection /></ProtectedRoute>
            } />
            <Route path="/go-online/standard" element={
              <ProtectedRoute requireApproved><StandardConfirm /></ProtectedRoute>
            } />
            <Route path="/go-online/return-cab" element={
              <ProtectedRoute requireApproved><ReturnCabSetup /></ProtectedRoute>
            } />

            {/* Active ride flow */}
            <Route path="/ride/incoming" element={
              <ProtectedRoute requireApproved><IncomingRequest /></ProtectedRoute>
            } />
            <Route path="/ride/navigate" element={
              <ProtectedRoute requireApproved>
                {DEMO_MODE ? <DemoBlock feature="Navigate to Pickup" /> : <NavigateToPickup />}
              </ProtectedRoute>
            } />
            <Route path="/ride/otp" element={
              <ProtectedRoute requireApproved>
                {DEMO_MODE ? <DemoBlock feature="OTP Verification" /> : <OTPVerify />}
              </ProtectedRoute>
            } />
            <Route path="/ride/in-progress" element={
              <ProtectedRoute requireApproved>
                {DEMO_MODE ? <DemoBlock feature="Trip in Progress" /> : <TripInProgress />}
              </ProtectedRoute>
            } />
            <Route path="/ride/end" element={
              <ProtectedRoute requireApproved>
                {DEMO_MODE ? <DemoBlock feature="Trip Completion" /> : <TripEnd />}
              </ProtectedRoute>
            } />

            {/* Onboarding */}
            <Route path="/onboarding/personal"      element={<ProtectedRoute><PersonalDetails /></ProtectedRoute>} />
            <Route path="/onboarding/documents"     element={<ProtectedRoute><Documents /></ProtectedRoute>} />
            <Route path="/onboarding/vehicle"       element={<ProtectedRoute><VehicleRegistration /></ProtectedRoute>} />
            <Route path="/onboarding/vehicle-docs"  element={<ProtectedRoute><VehicleDocuments /></ProtectedRoute>} />
            <Route path="/onboarding/selfie"        element={<ProtectedRoute><ReferenceSelfie /></ProtectedRoute>} />
            <Route path="/onboarding/pending-review" element={<ProtectedRoute><PendingReview /></ProtectedRoute>} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>

      {/* Persistent tab bar — renders null on non-main routes */}
      <BottomNav />
    </>
  )
}
