// The number plate, drawn like an Indian commercial plate (IND stripe, yellow, dark rim), as the hero of the sheet: a relative
// matches it against the car in front of them. Real text, not an image, so it is selectable and read by screen readers.
export default function TripPlate({ plate }: { plate: string | null }) {
  if (!plate) return null
  return (
    <div
      role="img"
      aria-label={`Number plate ${plate}`}
      className="inline-flex max-w-full items-stretch overflow-hidden rounded-[14px] border-[2.5px] border-[#111827] bg-gradient-to-b from-[#FFDD33] to-[#FFC800] shadow-[0_6px_16px_rgba(17,24,39,0.18),inset_0_1px_0_rgba(255,255,255,0.55)]"
    >
      <span aria-hidden className="flex w-8 flex-col items-center justify-end gap-1 bg-[#1E3A8A] pb-1.5 text-[9px] font-bold leading-none tracking-wider text-white">
        <span className="h-3 w-3 rounded-full border border-white/70" />
        IND
      </span>
      <span aria-hidden className="px-4 py-2.5 text-[clamp(22px,7.6vw,30px)] font-bold leading-none tracking-[0.07em] text-[#111827] tabular-nums" style={{ fontFamily: 'var(--font-display), sans-serif' }}>
        {plate}
      </span>
    </div>
  )
}
