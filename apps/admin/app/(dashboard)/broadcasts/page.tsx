'use client'

import { useState } from 'react'
import NewBroadcast from './NewBroadcast'
import BroadcastHistory from './BroadcastHistory'

export default function BroadcastsPage() {
  // Bumped when a broadcast is sent, so the history below loads it straight away.
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    // One column until there is room for the form (32rem) and a nine-column history side by side.
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] items-start">
      <NewBroadcast onSent={() => setRefreshKey((k) => k + 1)} />
      <BroadcastHistory refreshKey={refreshKey} />
    </div>
  )
}
