import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import ProtectedRoute from '@/components/ProtectedRoute'
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

export default function App() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <Routes location={location}>
      {/* Auth */}
      <Route path="/login" element={<Login />} />

      {/* Main — approved drivers only */}
      <Route path="/" element={
        <ProtectedRoute requireApproved>
          <Home />
        </ProtectedRoute>
      } />
      <Route path="/earnings" element={
        <ProtectedRoute requireApproved>
          <Earnings />
        </ProtectedRoute>
      } />
      <Route path="/wallet" element={
        <ProtectedRoute requireApproved>
          <Wallet />
        </ProtectedRoute>
      } />
      <Route path="/profile" element={
        <ProtectedRoute requireApproved>
          <Profile />
        </ProtectedRoute>
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
        <ProtectedRoute requireApproved><NavigateToPickup /></ProtectedRoute>
      } />
      <Route path="/ride/otp" element={
        <ProtectedRoute requireApproved><OTPVerify /></ProtectedRoute>
      } />
      <Route path="/ride/in-progress" element={
        <ProtectedRoute requireApproved><TripInProgress /></ProtectedRoute>
      } />
      <Route path="/ride/end" element={
        <ProtectedRoute requireApproved><TripEnd /></ProtectedRoute>
      } />

      {/* Onboarding — authenticated but not necessarily approved */}
      <Route path="/onboarding/personal" element={
        <ProtectedRoute><PersonalDetails /></ProtectedRoute>
      } />
      <Route path="/onboarding/documents" element={
        <ProtectedRoute><Documents /></ProtectedRoute>
      } />
      <Route path="/onboarding/vehicle" element={
        <ProtectedRoute><VehicleRegistration /></ProtectedRoute>
      } />
      <Route path="/onboarding/vehicle-docs" element={
        <ProtectedRoute><VehicleDocuments /></ProtectedRoute>
      } />
      <Route path="/onboarding/selfie" element={
        <ProtectedRoute><ReferenceSelfie /></ProtectedRoute>
      } />
      <Route path="/onboarding/pending-review" element={
        <ProtectedRoute><PendingReview /></ProtectedRoute>
      } />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}
