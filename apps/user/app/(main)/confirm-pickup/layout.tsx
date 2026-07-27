import GoogleMapsProvider from '@/components/ui/GoogleMapsProvider'

export default function ConfirmPickupLayout({ children }: { children: React.ReactNode }) {
  return <GoogleMapsProvider>{children}</GoogleMapsProvider>
}
