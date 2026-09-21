export const metadata = {
  title: 'Legal — Ocar',
}

// Deliberately outside (auth) and (main): reachable with no session (a
// prospective user reading Terms before signing up) and without MainLayout's
// active-ride redirect effect running on a page that has nothing to do with
// an in-progress ride. middleware.ts's PROTECTED/PUBLIC_ONLY lists don't
// include /legal, so it's unguarded in both directions.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-[100dvh] flex flex-col bg-background">{children}</div>
}
