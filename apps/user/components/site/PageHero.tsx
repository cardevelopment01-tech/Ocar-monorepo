// Dark inset hero shared by the public info pages (About, Fares, Contact), matching the landing hero.
export default function PageHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mx-auto max-w-6xl px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-hero px-5 py-12 sm:rounded-[40px] sm:px-12 md:py-20">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary/30 blur-[100px]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 right-0 h-80 w-80 rounded-full bg-accent/25 blur-[110px]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        />
        <div className="relative motion-safe:animate-fade-up">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-primary-bright">{eyebrow}</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-white md:text-6xl">
            {title}
          </h1>
          <div className="mt-5 max-w-2xl text-[16px] leading-relaxed text-slate-300">{children}</div>
        </div>
      </div>
    </section>
  )
}
