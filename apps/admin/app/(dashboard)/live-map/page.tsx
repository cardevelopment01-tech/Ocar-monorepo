'use client'
import dynamic from 'next/dynamic'

const LiveMap = dynamic(() => import('@/components/LiveMap'), {
  ssr: false,
  loading: () => <div className="skeleton flex-1 rounded-none" />,
})

export default function LiveMapPage() {
  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      <LiveMap />
    </div>
  )
}
