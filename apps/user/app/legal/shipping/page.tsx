import Link from 'next/link'

import { LegalDocument, type LegalSection } from '../LegalDocument'
import { CITIES_TEXT, COMPANY } from '@/lib/company'

export const metadata = { title: 'Shipping and Delivery Policy' }

const SECTIONS: LegalSection[] = [
  {
    heading: '1. What Ocar delivers',
    body: (
      <p>
        Ocar provides a service, not physical goods. There is nothing to ship, no courier is involved, and no
        delivery charge or delivery address applies. The service we deliver is a cab ride, arranged with an
        independent, verified driver.
      </p>
    ),
  },
  {
    heading: '2. Where the service is available',
    body: (
      <p>
        Ocar currently operates in {CITIES_TEXT}, Odisha, including intercity trips between
        them. Service is available only within areas we have enabled in the app, and we do not offer
        international service. If your pickup or drop point is outside our area, the app tells you before you
        book.
      </p>
    ),
  },
  {
    heading: '3. How and when the service is delivered',
    body: (
      <>
        <ul>
          <li>
            <span className="font-semibold text-text-primary">Instant rides:</span> once you confirm a booking we
            match you with a nearby driver, usually within a few minutes. You see the driver, vehicle and
            estimated arrival time in the app.
          </li>
          <li>
            <span className="font-semibold text-text-primary">Scheduled rides:</span> you choose a pickup date and
            time in advance. The driver is assigned ahead of the pickup time and you are notified by SMS and in
            the app.
          </li>
          <li>
            <span className="font-semibold text-text-primary">At pickup:</span> you share a 4-digit code with the
            driver to start the trip, and a second code to end it. The ride is delivered once it ends and you
            receive a receipt.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: '4. Confirmation and tracking',
    body: (
      <p>
        You receive a booking confirmation in the app and by SMS as soon as a driver accepts. From then until the
        trip ends you can follow the driver live on the map and message or call them through the app. Phone
        numbers stay hidden because calls are connected through a masked number.
      </p>
    ),
  },
  {
    heading: '5. Delays and non-fulfilment',
    body: (
      <p>
        Traffic, weather and road closures can affect arrival times, and estimates are not guarantees. If no
        driver is available, or the driver does not arrive, you are not charged, and any amount already paid
        online is refunded as described in our{' '}
        <Link href="/legal/refund-cancellation">Refund and Cancellation Policy</Link>.
      </p>
    ),
  },
  {
    heading: '6. Questions',
    body: (
      <p>
        Write to <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> or visit our{' '}
        <Link href="/contact">Contact page</Link>. Support is available {COMPANY.supportHours}.
      </p>
    ),
  },
]

export default function ShippingPage() {
  return (
    <LegalDocument
      title="Shipping and Delivery Policy"
      intro="Ocar sells a ride service, not physical products. Here is how and when that service is delivered."
      currentHref="/legal/shipping"
      sections={SECTIONS}
    />
  )
}
