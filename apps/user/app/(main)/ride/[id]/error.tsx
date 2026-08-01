'use client'

import { useRouter } from 'next/navigation'

export default function RideError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center text-3xl mb-5">
        ⚠️
      </div>
      <h2 className="text-[17px] font-bold text-gray-900 mb-2">Couldn&apos;t load your ride</h2>
      <p className="text-sm text-gray-500 mb-8 max-w-[260px]">
        Something went wrong. Your ride is still active. Tap retry to reconnect.
      </p>
      <div className="w-full max-w-[300px] space-y-3">
        <button
          onClick={reset}
          className="btn-primary w-full"
        >
          Retry
        </button>
        <button
          onClick={() => router.push('/home')}
          className="w-full py-3 text-sm font-medium text-gray-500 active:opacity-70 transition-opacity"
        >
          Go home
        </button>
      </div>
    </div>
  )
}
