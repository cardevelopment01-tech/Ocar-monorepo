import GoogleMapsProvider from '@/components/ui/GoogleMapsProvider'

export default function SelectRideLayout({ children }: { children: React.ReactNode }) {
  return <GoogleMapsProvider>{children}</GoogleMapsProvider>
}
