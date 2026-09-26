import SiteShell from '@/components/site/SiteShell'

export const metadata = {
  title: 'Legal',
}

// Deliberately outside (auth) and (main): reachable with no session (a
// prospective user or payment-gateway reviewer reading policies before signing
// up) and rendered in the public site shell, not the 430px app shell (see
// AppProviders). middleware.ts's PROTECTED/PUBLIC_ONLY lists don't include
// /legal, so it's unguarded in both directions.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>
}
