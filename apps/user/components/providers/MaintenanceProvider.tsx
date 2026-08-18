'use client'

import { useEffect, useState } from 'react'
import { getMaintenanceState, subscribeMaintenance, type MaintenanceState } from '@/lib/maintenance-store'
import MaintenanceScreen from '@/components/ui/MaintenanceScreen'

export default function MaintenanceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MaintenanceState>({ isUnderMaintenance: false })

  useEffect(() => {
    setState(getMaintenanceState())
    return subscribeMaintenance(setState)
  }, [])

  if (state.isUnderMaintenance) {
    return <MaintenanceScreen state={state} />
  }

  return <>{children}</>
}
