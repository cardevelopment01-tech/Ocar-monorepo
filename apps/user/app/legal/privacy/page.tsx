import { LegalDocument, type LegalSection } from '../LegalDocument'
import { COMPANY, formatAddress } from '@/lib/company'

export const metadata = { title: 'Privacy Policy' }

const SECTIONS: LegalSection[] = [
  {
    heading: '1. Who this policy covers',
    body: (
      <p>
        This Privacy Policy applies to everyone who uses the Ocar platform - riders booking rides, drivers
        accepting them, and the web and mobile apps through which either happens (Ocar rider app, Ocar driver
        app, and ocarindia.com). Ocar operates an intercity cab booking service across Bhubaneswar, Cuttack, and
        Puri, Odisha. It describes what personal data we collect, why, who we share it with, and the choices
        you have.
      </p>
    ),
  },
  {
    heading: '2. Information we collect',
    body: (
      <>
        <p><span className="font-semibold text-text-primary">Account &amp; identity:</span> your phone number
          (verified by one-time password), and optionally your name and email address.</p>
        <p><span className="font-semibold text-text-primary">Location:</span> your pickup and drop-off
          coordinates for every ride you book; a driver&apos;s live GPS position is tracked continuously while
          they are online and during an active trip, for matching, routing, fare calculation, and safety
          monitoring.</p>
        <p><span className="font-semibold text-text-primary">Trip &amp; payment data:</span> ride history,
          fares, cancellations, the payment method you use (cash, online via our payment gateway, or wallet), and your Ocar wallet
          balance and transaction ledger.</p>
        <p><span className="font-semibold text-text-primary">Driver verification data (drivers only):</span>
          driving licence, vehicle registration certificate, insurance, a selfie, and periodic daily-verification
          photos, used to confirm you are who you say you are and are legally permitted to drive.</p>
        <p><span className="font-semibold text-text-primary">Communications:</span> messages sent through
          in-ride chat between a rider and their matched driver, and device push-notification tokens.</p>
        <p><span className="font-semibold text-text-primary">Safety data:</span> SOS alerts (including your
          location at the time), ratings you give or receive, and any dispute or support messages you send us.</p>
        <p><span className="font-semibold text-text-primary">Technical data:</span> device type, app version,
          and crash/performance diagnostics, collected in aggregate to keep the service reliable - not used for
          advertising.</p>
      </>
    ),
  },
  {
    heading: '3. How we use it',
    body: (
      <p>
        We use this data to match riders with nearby drivers, calculate fares and routes, process payments,
        verify driver identity and eligibility to drive (as required under the Motor Vehicle Aggregator
        Guidelines, 2020), respond to SOS alerts and safety reports, resolve disputes, prevent fraud, provide
        customer support, and meet our legal and tax obligations. We do not sell your personal data, and we do
        not use your ride or location history for third-party advertising.
      </p>
    ),
  },
  {
    heading: '4. Who we share it with',
    body: (
      <>
        <p><span className="font-semibold text-text-primary">Your matched driver or rider:</span> name, photo,
          rating, and vehicle details are shown to the other party on a trip. Phone numbers are never shared
          directly - calls are connected through a masked number so neither side sees the other&apos;s real
          number.</p>
        <p><span className="font-semibold text-text-primary">Service providers acting on our behalf:</span>{' '}
          our RBI-authorised payment gateway partners (payment processing; card, UPI and bank details are entered on and stored by the gateway, never by Ocar), an SMS gateway (OTP delivery), Firebase Cloud Messaging (push
          notifications), and AWS (cloud hosting, database, and document storage). These providers only receive
          what they need to perform their function and are contractually restricted from using it for their own
          purposes.</p>
        <p><span className="font-semibold text-text-primary">Law enforcement and authorities:</span> where
          required by law, in response to a valid legal request, or where necessary to protect someone&apos;s
          safety in a genuine emergency (for example, an SOS alert).</p>
      </>
    ),
  },
  {
    heading: '5. How long we keep it',
    body: (
      <p>
        Ride, fare, and payment records are retained for as long as required under applicable financial and
        tax record-keeping laws. Driver verification documents are retained for the duration of an active
        driver account and for a limited period afterward, as required for regulatory and safety compliance.
        Chat messages and precise location history are retained only as long as needed for safety, dispute
        resolution, and fraud prevention, after which they are deleted or anonymized.
      </p>
    ),
  },
  {
    heading: '6. How we protect it',
    body: (
      <p>
        Data in transit is encrypted (HTTPS/TLS). One-time passwords and session refresh tokens are never
        stored in plain text - only their cryptographic hash is kept. On the driver and rider apps, your
        authentication token is stored using your device&apos;s secure hardware-backed storage (Android
        Keystore / iOS Keychain), not plain app storage. Access to production data is restricted to authorized
        personnel, and our infrastructure and code are continuously scanned for known vulnerabilities and
        exposed secrets.
      </p>
    ),
  },
  {
    heading: '7. Your rights',
    body: (
      <p>
        Under India&apos;s Digital Personal Data Protection Act, 2023, you have the right to access the
        personal data we hold about you, request correction of inaccurate data, request erasure of your data
        (subject to our legal retention obligations above), withdraw consent where processing is based on
        consent, and nominate another individual to exercise these rights on your behalf in the event of your
        death or incapacity. To exercise any of these rights, contact us using the details in Section 10 below.
      </p>
    ),
  },
  {
    heading: '8. Cookies and similar technology',
    body: (
      <p>
        The Ocar web app uses a small number of essential cookies to keep you signed in (for example,
        <span className="font-mono text-[12px]"> ocar_user_session</span>). We do not use third-party
        advertising or tracking cookies.
      </p>
    ),
  },
  {
    heading: '9. Age requirement',
    body: (
      <p>
        Ocar is intended for use by individuals aged 18 and older. We do not knowingly collect personal data
        from anyone under 18. If you believe a minor has created an account, please contact us and we will
        remove it.
      </p>
    ),
  },
  {
    heading: '10. Grievance Officer &amp; contact',
    body: (
      <>
        <p>
          In accordance with the Information Technology Act, 2000 and the rules made thereunder, the Grievance
          Officer for Ocar can be reached at:
        </p>
        <p>
          <span className="font-semibold text-text-primary">{COMPANY.grievanceOfficer.name}</span>
          <br />
          {COMPANY.legalName}, {formatAddress()}
          <br />
          Email: <a href={`mailto:${COMPANY.grievanceOfficer.email}`}>{COMPANY.grievanceOfficer.email}</a>
        </p>
        <p>We acknowledge complaints within 48 hours and aim to resolve them within 15 days.</p>
      </>
    ),
  },
  {
    heading: '11. Changes to this policy',
    body: (
      <p>
        We may update this Privacy Policy from time to time to reflect changes in our practices or in
        applicable law. We will update the &ldquo;Last updated&rdquo; date above when we do, and for material
        changes we will notify you in-app or by SMS/email before they take effect.
      </p>
    ),
  },
]

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro="What personal data Ocar collects, why we collect it, who we share it with, and the choices you have."
      currentHref="/legal/privacy"
      sections={SECTIONS}
    />
  )
}
