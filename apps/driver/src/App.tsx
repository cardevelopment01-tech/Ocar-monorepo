import { Routes, Route } from 'react-router-dom'

// TODO: implement in Module M01 — replace placeholders with real page components
function Placeholder({ name }: { name: string }) {
  return <div>{name} — TODO</div>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Placeholder name="Login" />} />
      <Route path="/" element={<Placeholder name="Home" />} />
      <Route path="/earnings" element={<Placeholder name="Earnings" />} />
      <Route path="/wallet" element={<Placeholder name="Wallet" />} />
      <Route path="/onboarding/personal" element={<Placeholder name="PersonalDetails" />} />
      <Route path="/onboarding/documents" element={<Placeholder name="Documents" />} />
      <Route path="/onboarding/vehicle" element={<Placeholder name="VehicleRegistration" />} />
      <Route path="/onboarding/vehicle-docs" element={<Placeholder name="VehicleDocuments" />} />
      <Route path="/onboarding/selfie" element={<Placeholder name="ReferenceSelfie" />} />
      <Route path="/go-online/mode" element={<Placeholder name="ModeSelection" />} />
      <Route path="/go-online/standard" element={<Placeholder name="StandardConfirm" />} />
      <Route path="/go-online/return-cab" element={<Placeholder name="ReturnCabSetup" />} />
      <Route path="/ride/incoming" element={<Placeholder name="IncomingRequest" />} />
      <Route path="/ride/navigate" element={<Placeholder name="NavigateToPickup" />} />
      <Route path="/ride/otp" element={<Placeholder name="OTPVerify" />} />
      <Route path="/ride/in-progress" element={<Placeholder name="TripInProgress" />} />
      <Route path="/ride/end" element={<Placeholder name="TripEnd" />} />
    </Routes>
  )
}
