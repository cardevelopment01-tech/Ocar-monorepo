import Link from 'next/link'

import { LegalDocument, type LegalSection } from '../LegalDocument'
import { COMPANY } from '@/lib/company'

export const metadata = { title: 'Refund and Cancellation Policy' }

// Timelines below (refund windows, response times) are business commitments,
// not values read from code. Confirm them with operations/finance before the
// site is submitted for payment-gateway approval.
const SECTIONS: LegalSection[] = [
  {
    heading: '1. Cancelling a ride',
    body: (
      <>
        <p>
          You can cancel a booking at any time from the ride screen in the Ocar app or website. What it costs
          depends on how far the booking has progressed:
        </p>
        <ul>
          <li>
            <span className="font-semibold text-text-primary">Before a driver accepts:</span> free. Nothing is
            charged, and any amount you already paid online is refunded in full.
          </li>
          <li>
            <span className="font-semibold text-text-primary">After a driver has accepted:</span> a small
            cancellation fee may apply, because the driver has already started towards you. The fee amount is
            shown on the cancellation screen before you confirm, so you always know it up front.
          </li>
          <li>
            <span className="font-semibold text-text-primary">After the trip has started:</span> the fare for the
            distance and time already travelled applies.
          </li>
        </ul>
        <p>
          A cancellation fee is waived where the cancellation is caused by the driver or by a problem on Ocar&apos;s
          side, for example the driver asking you to cancel, not moving towards the pickup point, or being
          unreachable.
        </p>
      </>
    ),
  },
  {
    heading: '2. When the driver cancels',
    body: (
      <p>
        If a driver cancels after accepting your ride, you are never charged. We automatically look for another
        driver, and if you choose to stop, any amount you paid online for that ride is refunded in full.
      </p>
    ),
  },
  {
    heading: '3. When you are eligible for a refund',
    body: (
      <>
        <p>We refund you in these situations:</p>
        <ul>
          <li>You paid online and the ride was cancelled without a cancellation fee.</li>
          <li>Your money was debited but the booking was not confirmed (failed or duplicate payment).</li>
          <li>The ride could not be provided because no driver was available or the driver did not arrive.</li>
          <li>You were charged more than the fare you were shown, or a fare component was applied incorrectly.</li>
          <li>A dispute you raise is reviewed and we confirm the charge was wrong, in full or in part.</li>
        </ul>
        <p>
          Completed rides charged at the correct fare, and cancellation fees applied as shown before you
          confirmed, are not refundable.
        </p>
      </>
    ),
  },
  {
    heading: '4. How refunds are paid and how long they take',
    body: (
      <>
        <p>
          <span className="font-semibold text-text-primary">Online payments (UPI, cards, net banking):</span>{' '}
          refunded to the same account or instrument you paid from. Once we approve a refund it is sent to the
          payment gateway immediately, and your bank typically credits it within 5 to 7 business days.
        </p>
        <p>
          <span className="font-semibold text-text-primary">Ocar wallet payments:</span> refunded to your Ocar
          wallet within 24 hours of approval. Refund credit added to your wallet does not expire and can be used
          on any future ride.
        </p>
        <p>
          <span className="font-semibold text-text-primary">Cash rides:</span> if you were overcharged in cash and
          the claim is approved, the difference is credited to your Ocar wallet.
        </p>
        <p>
          Failed or duplicate online payments that were not matched to a booking are automatically reversed to
          the original payment method within 5 to 7 business days.
        </p>
      </>
    ),
  },
  {
    heading: '5. How to request a refund',
    body: (
      <>
        <p>
          Open the ride in your trip history and choose Help &amp; Support to raise a dispute, or email us at{' '}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> with your registered phone number
          and the ride date. Please raise the request within 7 days of the ride.
        </p>
        <p>
          We acknowledge every request within 2 business days and review the trip record (route, timestamps, chat
          and payment history) before deciding. You will be told the outcome, and the reason if a refund is
          declined, by SMS and in the app.
        </p>
      </>
    ),
  },
  {
    heading: '6. Still not resolved?',
    body: (
      <p>
        If you are unhappy with the outcome, write to our Grievance Officer using the details in our{' '}
        <Link href="/legal/privacy">Privacy Policy</Link>, or reach us any time on the{' '}
        <Link href="/contact">Contact page</Link>. Your bank or card issuer&apos;s own dispute process remains
        available to you as well.
      </p>
    ),
  },
]

export default function RefundCancellationPage() {
  return (
    <LegalDocument
      title="Refund and Cancellation Policy"
      intro="What it costs to cancel a ride, when you get your money back, how it is paid, and how long it takes."
      currentHref="/legal/refund-cancellation"
      sections={SECTIONS}
    />
  )
}
