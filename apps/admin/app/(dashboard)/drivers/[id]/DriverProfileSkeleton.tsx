// A placeholder shaped like the driver profile (breadcrumb, header card with avatar and actions, tab row, two content cards), so the
// swap to the real page does not jump. Shared by loading.tsx (shown the instant a row is clicked) and the page's own first load.
// The shimmer is the admin's `.skeleton` style; it stands still for people who ask for reduced motion.
const bar = 'skeleton motion-reduce:animate-none'

export default function DriverProfileSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading driver">
      <div className="flex items-center gap-2">
        <div className={`${bar} h-3 w-14`} />
        <div className={`${bar} h-3 w-2`} />
        <div className={`${bar} h-3 w-28`} />
      </div>

      <div className="admin-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className={`${bar} h-14 w-14 rounded-full`} />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className={`${bar} h-6 w-44`} />
                <div className={`${bar} h-5 w-16 rounded-full`} />
              </div>
              <div className={`${bar} h-3.5 w-20`} />
              <div className={`${bar} h-3.5 w-28`} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`${bar} h-9 w-32 rounded-xl`} />
            <div className={`${bar} h-9 w-9 rounded-xl`} />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {[64, 88, 72, 80, 64].map((w, i) => <div key={i} className={`${bar} h-8 rounded-lg`} style={{ width: w }} />)}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {[0, 1].map(card => (
          <div key={card} className="admin-card space-y-3">
            <div className={`${bar} h-4 w-32`} />
            {[100, 85, 92, 70].map((w, i) => (
              <div key={i} className="flex justify-between gap-4">
                <div className={`${bar} h-3.5 w-24`} />
                <div className={`${bar} h-3.5`} style={{ width: `${w * 0.45}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
