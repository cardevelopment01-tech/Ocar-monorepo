'use client'
import dynamic from 'next/dynamic'

const LiveMap = dynamic(() => import('@/components/LiveMap'), {
  ssr: false,
  loading: () => <div className="skeleton flex-1 rounded-none" />,
})

export default function LiveMapPage() {
  return (
    // The layout pads the page by 1.5rem on every side, so the card is that much shorter than the space under the top bar.
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card" style={{ height: 'calc(100vh - 64px - 3rem)' }}>
      <LiveMap />
    </div>
  )
}
