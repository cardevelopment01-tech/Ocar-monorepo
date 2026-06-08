import { useNavigate } from 'react-router-dom'
import TripRequestCard from '@/components/ui/TripRequestCard'
import { mockIncomingRequest } from '@/lib/mock-data'

export default function IncomingRequest() {
  const navigate = useNavigate()

  return (
    <div className="w-full h-screen bg-bg">
      <TripRequestCard
        pickup={mockIncomingRequest.pickup}
        drop={mockIncomingRequest.drop}
        pickupDistance={mockIncomingRequest.pickupDistance}
        tripDistance={mockIncomingRequest.tripDistance}
        fare={mockIncomingRequest.fare}
        timeRemaining={mockIncomingRequest.timeRemaining}
        onAccept={() => navigate('/ride/navigate')}
        onDecline={() => navigate('/')}
      />
    </div>
  )
}
