// The number plate, drawn like an Indian commercial plate (IND stripe, yellow, dark rim), as the hero of the sheet: a relative
// matches it against the car in front of them. Real text, not an image, so it is selectable and read by screen readers.
export default function TripPlate({ plate }: { plate: string | null }) {
  if (!plate) return null
  return (
    <div
      role="img"
      aria-label={`Number plate ${plate}`}
      className="inline-flex max-w-full items-stretch overflow-hidden rounded-xl border-[3px] border-text-primary bg-[#FFD21F] shadow-card"
    >
      <span aria-hidden className="flex w-9 flex-col items-center justify-center bg-[#1E3A8A] text-[10px] font-extrabold leading-none text-white">
        IND
      </span>
      <span aria-hidden className="px-4 py-2 font-mono text-[clamp(20px,7.2vw,28px)] font-extrabold leading-none tracking-[0.08em] text-text-primary tabular-nums">
        {plate}
      </span>
    </div>
  )
}
