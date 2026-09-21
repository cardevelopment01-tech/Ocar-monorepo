'use client'

import { LegalDocument, type LegalSection } from '../LegalDocument'

const SECTIONS: LegalSection[] = [
  {
    heading: '1. Acceptance of these terms',
    body: (
      <p>
        By creating an Ocar account or using the Ocar rider or driver app, you agree to these Terms &amp;
        Conditions and to our <span className="font-semibold text-text-primary">Privacy Policy</span>. If you
        do not agree, please do not use the platform.
      </p>
    ),
  },
  {
    heading: '2. Eligibility',
    body: (
      <p>
        You must be at least 18 years old and able to form a legally binding contract to use Ocar. You must
        provide a valid Indian mobile number to register, and keep the one-time passwords sent to it
        confidential — you are responsible for all activity on your account. Drivers must additionally hold a
        valid driving licence and vehicle documents, and pass Ocar&apos;s verification process before
        accepting rides.
      </p>
    ),
  },
  {
    heading: '3. What Ocar is',
    body: (
      <p>
        Ocar is a technology platform that connects riders who need a trip with independent, verified drivers
        operating in Bhubaneswar, Cuttack, and Puri. Ocar is an intermediary under the Motor Vehicle Aggregator
        Guidelines, 2020 — drivers are independent and responsible for the actual provision of transportation.
        Ocar is not itself a taxi or transport operator.
      </p>
    ),
  },
  {
    heading: '4. Bookings, fares, and cancellations',
    body: (
      <>
        <p>
          Fare estimates shown at booking are based on distance, time, and vehicle category, and may change if
          your actual route or stops differ, or during periods of high demand. The final fare is shown at the
          end of the trip.
        </p>
        <p>
          Cancelling a ride before a driver has reached the pickup point is generally free. Cancelling after
          the driver has arrived, or repeated cancellations, may incur a cancellation fee, shown to you before
          you confirm the cancellation.
        </p>
      </>
    ),
  },
  {
    heading: '5. Payments',
    body: (
      <p>
        You agree to pay the full fare for every completed ride, by cash to the driver or online through
        Razorpay, or from your Ocar wallet balance. If you dispute a charge, contact Ocar support within a
        reasonable time of the ride; we will investigate and, where a discrepancy is confirmed, correct it.
      </p>
    ),
  },
  {
    heading: '6. Conduct',
    body: (
      <>
        <p>
          Riders must not abuse, threaten, or endanger a driver, damage a vehicle, or use the platform for any
          unlawful purpose. Drivers must not endanger passenger safety, discriminate against riders, or
          misrepresent their identity, vehicle, or documents.
        </p>
        <p>
          Violating this section may result in warnings, suspension, or permanent removal from the platform,
          at Ocar&apos;s discretion, and may be reported to the relevant authorities where the law requires or
          permits it.
        </p>
      </>
    ),
  },
  {
    heading: '7. Safety features',
    body: (
      <p>
        Ocar provides an in-app SOS button that shares your location with our safety team, OTP-verified trip
        start and end, live GPS tracking of every trip, and a post-ride rating system. These features are
        provided to help keep trips safe, but Ocar cannot guarantee the conduct of any individual driver or
        rider, and use of the platform is at your own risk to the extent permitted by law.
      </p>
    ),
  },
  {
    heading: '8. Ratings and disputes',
    body: (
      <p>
        Riders and drivers may rate each other after a trip. If you believe a charge, rating, or incident was
        handled unfairly, you may raise a dispute through the app&apos;s Help &amp; Support section; we will
        review the available trip data (route, timestamps, chat, and payment records) and respond.
      </p>
    ),
  },
  {
    heading: '9. Limitation of liability',
    body: (
      <p>
        To the maximum extent permitted by law, Ocar&apos;s liability for any claim arising from your use of
        the platform is limited to the amount you paid for the specific ride giving rise to the claim. Ocar is
        not liable for the independent acts or omissions of drivers or riders, who are not Ocar employees or
        agents, except where liability cannot be excluded under applicable law.
      </p>
    ),
  },
  {
    heading: '10. Termination',
    body: (
      <p>
        You may stop using Ocar at any time by no longer using the app. We may suspend or terminate your
        access if you violate these terms, provide false information, or if required to do so by law, with
        notice where reasonably possible.
      </p>
    ),
  },
  {
    heading: '11. Governing law',
    body: (
      <p>
        These Terms are governed by the laws of India. Any dispute arising from these Terms or your use of
        Ocar is subject to the exclusive jurisdiction of the courts at Bhubaneswar, Odisha.
      </p>
    ),
  },
  {
    heading: '12. Changes to these terms',
    body: (
      <p>
        We may update these Terms from time to time. We will update the &ldquo;Last updated&rdquo; date above,
        and for material changes we will notify you in-app or by SMS/email before they take effect. Continued
        use of Ocar after changes take effect constitutes acceptance of the updated Terms.
      </p>
    ),
  },
  {
    heading: '13. Contact us',
    body: (
      <p className="text-text-primary font-medium">
        [support@ocar.app] · [registered business address, Odisha]
      </p>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms & Conditions"
      crossLinkLabel="Read our Privacy Policy"
      crossLinkHref="/legal/privacy"
      sections={SECTIONS}
    />
  )
}
