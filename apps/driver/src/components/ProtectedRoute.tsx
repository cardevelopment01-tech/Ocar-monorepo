import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useAuthStore'

interface Props {
  children: React.ReactNode
  requireApproved?: boolean
}

export default function ProtectedRoute({ children, requireApproved = false }: Props) {
  const { isAuthenticated, driver } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (requireApproved && driver?.status !== 'active') {
    const step = driver?.onboarding_step ?? 'personal_info'
    const stepRoutes: Record<string, string> = {
      personal_info: '/onboarding/personal',
      vehicle_info:  '/onboarding/vehicle',
      documents:     '/onboarding/documents',
      vehicle_docs:  '/onboarding/vehicle-docs',
      selfie:        '/onboarding/selfie',
    }
    return <Navigate to={stepRoutes[step] ?? '/onboarding/personal'} replace />
  }

  return <>{children}</>
}
