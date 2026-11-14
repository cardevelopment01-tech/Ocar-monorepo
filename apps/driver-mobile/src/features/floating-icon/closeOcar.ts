// The driver dropped the floating icon on the X. Close Ocar completely, but do NOT take the driver offline: the server ends a silent
// session by itself after the offline period, and reopening Ocar picks the driver up again. Location tracking is stopped first because
// Android restarts a killed location service on its own; the native side stops the service too and then ends the process.
export async function closeOcar(deps: { stopTracking: () => Promise<void>; exitApp: () => void }): Promise<void> {
  try {
    await deps.stopTracking()
  } catch {
    // Stopping can fail (task already gone). The native exitApp stops the service and ends the process anyway.
  }
  deps.exitApp()
}
