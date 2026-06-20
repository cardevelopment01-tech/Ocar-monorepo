import { memo } from 'react'
import { Marker } from 'react-map-gl/maplibre'

type PinVariant = 'pickup' | 'drop'

function LocationPin({ position, variant }: { position: [number, number]; variant: PinVariant }) {
  const isPickup = variant === 'pickup'
  const bg = isPickup ? '#22C55E' : '#0F172A'

  return (
    <Marker latitude={position[0]} longitude={position[1]} anchor="center">
      <div style={{ position: 'relative', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isPickup && (
          <div
            className="animate-ping"
            style={{ position: 'absolute', width: 36, height: 36, borderRadius: '50%', background: 'rgba(34,197,94,0.18)' }}
          />
        )}
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: bg,
          border: '2px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }} />
        </div>
      </div>
    </Marker>
  )
}

export default memo(LocationPin, (a, b) =>
  a.variant === b.variant &&
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1]
)
