import GoogleMapsProvider from '@/components/ui/GoogleMapsProvider'

export default function RideLayout({ children }: { children: React.ReactNode }) {
  return <GoogleMapsProvider>{children}</GoogleMapsProvider>
}
