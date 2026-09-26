import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'

export default function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
}
