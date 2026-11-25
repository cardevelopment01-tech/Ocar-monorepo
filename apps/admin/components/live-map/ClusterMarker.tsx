'use client'

import { memo } from 'react'
import { AdvancedMarker } from '@vis.gl/react-google-maps'
import { STAGE_META } from '@/lib/live-map-model'
import type { Cluster } from '@/lib/live-map-cluster'

// Several nearby drivers as one numbered circle, coloured by the most urgent of them. Clicking it zooms to show them (done by the map).
export const ClusterMarker = memo(function ClusterMarker({ cluster, onClick }: { cluster: Cluster; onClick: () => void }) {
  const color = STAGE_META[cluster.stage].color
  const size = 32 + Math.min(20, Math.round(Math.log2(cluster.count) * 4))
  return (
    <AdvancedMarker position={{ lat: cluster.lat, lng: cluster.lng }} onClick={onClick} zIndex={2} title={`${cluster.count} drivers: click to zoom in`}>
      <div
        role="button"
        aria-label={`${cluster.count} drivers`}
        className={`flex items-center justify-center rounded-full border-[3px] border-white font-display font-bold text-[13px] tabular-nums shadow-lg ring-4 ring-white/40 cursor-pointer ${cluster.stage === 'waiting' ? 'text-text-primary' : 'text-white'}`}
        style={{ width: size, height: size, background: color }}
      >
        {cluster.count}
      </div>
    </AdvancedMarker>
  )
}, (prev, next) => {
  const a = prev.cluster, b = next.cluster
  return a.key === b.key && a.count === b.count && a.stage === b.stage && a.lat === b.lat && a.lng === b.lng
})
