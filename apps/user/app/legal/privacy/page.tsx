import Link from 'next/link'

import { Callout, DataTable } from '../LegalPrimitives'
import { LegalDocument, type LegalSection } from '../LegalDocument'
import { COMPANY, formatAddress } from '@/lib/company'

export const metadata = {
  title: 'Privacy Policy',
  description:
    'What personal data Ocar collects, why, who we share it with, how long we keep it, and your rights under the Digital Personal Data Protection Act, 2023.',
}

const SUMMARY = [
  'We collect what we need to run rides safely: your mobile number, your location while you use the app, and your trip and payment records. Drivers also give us identity and vehicle documents and selfies.',
  'We do not sell your personal data, and we do not use your rides or location for advertising.',
  'Calls between rider and driver are connected through a masked number, so neither sees the other’s real number.',
  'Card, UPI and bank details are entered on our payment partners’ pages. Ocar does not store them.',
  'We use crash-reporting and usage tools to fix bugs. They identify you by an internal number, never by your name, phone number, email or location.',
  'You can ask to see, correct or delete your data at any time, and you can complain to us and to the Data Protection Board of India. See section 11.',
]

const SECTIONS: LegalSection[] = [
  {
    heading: '1. About this policy',
    body: (
      <>
        <p>
          This policy explains how {COMPANY.legalName} (&ldquo;Ocar&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
          handles personal data. We are the &ldquo;data fiduciary&rdquo; under India&apos;s Digital Personal Data
          Protection Act, 2023 (the &ldquo;DPDP Act&rdquo;) and the person responsible for your data under the
          Information Technology Act, 2000 and its rules.
        </p>
        <p>
          It covers the Ocar rider app, the Ocar driver app and the website at ocarindia.com. Ocar is an intercity
          cab booking service in Bhubaneswar, Cuttack and Puri, Odisha. If you do not agree with this policy, please
          do not register or use the service. When you register and tap to continue, you give your consent to the
          handling of your data described here. Our <Link href="/legal/terms">Terms and Conditions</Link> govern the
          service itself.
        </p>
      </>
    ),
  },
  {
    heading: '2. The personal data we collect',
    body: (
      <>
        <p>We collect only what the service needs. What we collect depends on whether you ride or drive.</p>
        <DataTable
          caption="Personal data we collect"
          head={['Type of data', 'What it includes', 'Who it applies to']}
          rows={[
            [
              'Account details',
              'Mobile number (verified by a one-time password), name, optional email address, gender and date of birth where needed, address.',
              'Riders and drivers. Date of birth, address and an emergency contact are asked of drivers.',
            ],
            [
              'Location',
              'Pickup and drop-off points, searches for places, and your live location. Riders: while the app is open. Drivers: continuously while online and during a trip, including when the app is in the background.',
              'Riders and drivers',
            ],
            [
              'Trips and payments',
              'Ride history and routes, fares, cancellations, ratings, payment status, and your Ocar wallet balance and transactions. Drivers also give bank or UPI details for payouts.',
              'Riders and drivers',
            ],
            [
              'Driver verification',
              'Driving licence, Aadhaar number, vehicle registration, insurance, permit and fitness and pollution certificates, a profile selfie, and a daily selfie and number-plate photo.',
              'Drivers only',
            ],
            [
              'Messages and calls',
              'Chat messages between a rider and their driver, records that a masked call took place (time and duration), and messages you send to support.',
              'Riders and drivers',
            ],
            [
              'Safety',
              'SOS alerts with your location and time, disputes and reports you raise or that are raised about you.',
              'Riders and drivers',
            ],
            [
              'Device and technical',
              'Phone model, operating system, app version, language, push-notification token, IP address, crash reports, performance measurements, and records of which screens and actions are used.',
              'Riders and drivers',
            ],
          ]}
        />
        <p>
          We do not read your contacts, messages or call history, and the apps do not record audio or video of your
          trips.
        </p>
      </>
    ),
  },
  {
    heading: '3. Why we use your data',
    body: (
      <>
        <DataTable
          caption="Purposes for which we use personal data"
          head={['Purpose', 'Examples']}
          rows={[
            ['Provide the service', 'Match riders with nearby drivers, show the route and arrival time, calculate the fare, run the wallet, and send trip updates.'],
            ['Take and send payments', 'Collect fares and wallet top-ups through our payment gateway, and pay drivers.'],
            ['Check drivers are allowed to drive', 'Verify identity, licence and vehicle documents and daily selfies, as the Motor Vehicle Aggregator Guidelines expect of us.'],
            ['Keep people safe', 'Respond to SOS alerts and safety reports, investigate incidents, and suspend accounts that put others at risk.'],
            ['Prevent fraud and misuse', 'Detect fake accounts, repeated cancellations, payment abuse and attempts to break into accounts.'],
            ['Support and disputes', 'Answer your questions, review a fare or complaint, and keep a record of what was decided.'],
            ['Improve and secure the apps', 'Find and fix crashes and slow screens, and understand which features are used so we can make them better.'],
            ['Meet legal duties', 'Keep tax and accounting records, respond to lawful requests from courts and authorities, and report incidents as required.'],
          ]}
        />
        <p>
          We use your data only for these purposes. We process it with your consent, given when you register and use
          the service, and without consent only where the law allows or requires it, for example to respond to an
          emergency, to comply with a court order, or to keep records the law requires.
        </p>
      </>
    ),
  },
  {
    heading: '4. Permissions on your phone',
    body: (
      <>
        <p>The apps ask for these permissions. You can turn them off in your phone settings, but some features will stop working.</p>
        <DataTable
          caption="Phone permissions requested by the Ocar apps"
          head={['Permission', 'Why', 'App']}
          rows={[
            ['Location (precise and approximate)', 'To find nearby cabs, set pickup points, track the trip and calculate the fare.', 'Rider and driver'],
            ['Location in the background', 'So a driver who is online keeps receiving ride requests and trips are tracked when the screen is off. A notification is always shown while this is active.', 'Driver only'],
            ['Camera and photos', 'To take or choose photos of documents, a profile selfie, and the daily selfie and number-plate photo. We only access what you pick or capture.', 'Driver only'],
            ['Notifications', 'To tell you about ride requests, driver arrival, payments and document reviews.', 'Rider and driver'],
          ]}
        />
      </>
    ),
  },
  {
    heading: '5. Crash reporting, analytics and diagnostics',
    body: (
      <>
        <p>To keep the apps reliable we use a few tools that run inside them and send us technical information:</p>
        <ul>
          <li><strong>Firebase Crashlytics and Firebase Cloud Messaging (Google).</strong> Crash reports and delivery of push notifications. Crashlytics uses an app-installation identifier.</li>
          <li><strong>Sentry.</strong> Error and slow-screen reports, with the steps that led up to a problem.</li>
          <li><strong>PostHog.</strong> Product analytics: which screens are opened and whether steps such as logging in, going online or booking and cancelling a ride succeed or fail.</li>
        </ul>
        <p>
          These tools identify you only by an internal account number (for example &ldquo;rider:123&rdquo;). We
          configure them not to send your phone number, name, email, address or coordinates, and web addresses are
          trimmed so that anything after a question mark is removed before it leaves your phone. We do not record
          your screen. We do not use this data for advertising.
        </p>
      </>
    ),
  },
  {
    heading: '6. Who we share your data with',
    body: (
      <>
        <p>We never sell personal data. We share it only in these cases.</p>
        <DataTable
          caption="Who personal data is shared with"
          head={['Who', 'What they receive', 'Why']}
          rows={[
            ['The other person on your trip', 'Rider: name, photo, rating, vehicle and number plate, live location. Driver: pickup and drop-off, and the rider’s name and rating. Phone numbers are masked.', 'So the trip can happen safely.'],
            ['Payment partners', 'Amount, order reference and the details needed to complete a payment or a driver payout. Card, UPI and bank details go straight to them.', 'PayU collects payments and Razorpay makes driver payouts; both are RBI-authorised.'],
            ['Cloud and messaging providers', 'Data needed to host the service, send one-time passwords by SMS, connect masked calls and deliver push notifications.', 'Amazon Web Services (India data centres), our SMS and voice provider, and Google (Firebase).'],
            ['Maps provider', 'Locations and search text.', 'Google Maps Platform, to show maps, find places and addresses and plan routes.'],
            ['Monitoring providers', 'Technical data described in section 5, and server logs.', 'Sentry, PostHog, Google Crashlytics and our infrastructure monitoring service.'],
            ['Authorities and courts', 'What the request or the law requires.', 'To comply with the law, a valid legal order, or to protect someone in a genuine emergency such as an SOS.'],
            ['Advisers and successors', 'What is needed for the purpose.', 'Our auditors and lawyers, and a buyer if the business is sold, who must keep to this policy.'],
          ]}
        />
        <p>
          Providers that handle data for us may use it only to do that work, and must protect it. Where we are legally
          required to, we tell you when your data is shared with an authority, unless the law forbids it.
        </p>
      </>
    ),
  },
  {
    heading: '7. Where your data is stored and sent',
    body: (
      <p>
        Our main systems and the documents drivers upload are hosted in India. Some of the tools in section 5 and
        Google services process data on servers outside India, including in the United States. We transfer data
        abroad only to providers that protect it, and only where Indian law permits.
      </p>
    ),
  },
  {
    heading: '8. How long we keep it',
    body: (
      <>
        <DataTable
          caption="How long personal data is kept"
          head={['Data', 'How long']}
          rows={[
            ['Account details', 'While your account is open. Deleted when you delete the account, apart from what is listed below.'],
            ['Ride, fare and payment records', 'As long as tax and accounting law requires. After you delete your account, your name and phone number are removed from them.'],
            ['Driver documents and selfies', 'While the driver account is active, and for a limited period afterwards as safety and regulatory rules require.'],
            ['Detailed location history of a trip', 'Up to 90 days, unless it is needed for an open safety report, dispute or legal request, in which case we keep it until that is closed.'],
            ['Chat messages and masked-call records', 'While needed for safety, disputes and fraud prevention, then deleted or anonymised.'],
            ['Notifications', 'Up to 90 days.'],
            ['Server and security logs', 'At least 180 days, as the CERT-In Directions require, and up to one year.'],
            ['One-time passwords', 'A few minutes. We keep only a scrambled (hashed) copy while it is valid.'],
            ['Crash and analytics data', 'For limited periods set in our provider settings, then deleted by the provider.'],
          ]}
        />
        <p>Where the law requires us to keep something longer, we keep it only for that purpose and then delete it.</p>
      </>
    ),
  },
  {
    heading: '9. How we protect it',
    body: (
      <ul>
        <li>Data travels over encrypted connections (HTTPS/TLS) and is encrypted where it is stored.</li>
        <li>One-time passwords and session tokens are never stored as readable text, only as hashes. On your phone, your sign-in token is kept in the device&apos;s secure storage.</li>
        <li>Driver documents are kept in private storage. Staff view them only through short-lived links, and reviews of driver accounts are recorded in a log that cannot be edited.</li>
        <li>Access to production systems is limited to staff who need it, and our code and systems are scanned for known weaknesses.</li>
        <li>If a breach affects your personal data, we will tell you, the Data Protection Board of India and CERT-In as the law requires.</li>
      </ul>
    ),
  },
  {
    heading: '10. Safety features and emergencies',
    body: (
      <p>
        When you trigger the SOS button, we record your location and the time and alert our operations team, who may
        contact you, your emergency contact or the police. Where there is a risk to life or safety we may share your
        location and trip details with the police or emergency services, even if you cannot give consent at that
        moment. Ratings, reports and disputes are kept so that we can act on repeated problems.
      </p>
    ),
  },
  {
    heading: '11. Your rights and how to use them',
    body: (
      <>
        <p>Under the DPDP Act you have the right to:</p>
        <ul>
          <li>get a summary of the personal data we hold about you and who we have shared it with;</li>
          <li>have inaccurate or incomplete data corrected, completed or updated;</li>
          <li>have your data erased, unless the law requires us to keep it;</li>
          <li>withdraw your consent at any time. It is as easy to withdraw as to give, but we may then be unable to provide the service;</li>
          <li>nominate someone to exercise these rights for you if you die or cannot act for yourself; and</li>
          <li>have a complaint about your data heard and answered.</li>
        </ul>
        <p>
          You can delete your account from the Profile tab of the app, or follow the steps at{' '}
          <Link href="/legal/delete-account">Delete your account</Link>. For anything else, email{' '}
          <a href={`mailto:${COMPANY.supportEmail}?subject=Privacy%20request`}>{COMPANY.supportEmail}</a> with the subject
          &ldquo;Privacy request&rdquo;. We may ask you to confirm it is you before we act. We acknowledge requests within 48
          hours and aim to complete them within 15 days.
        </p>
        <Callout title="If we do not resolve your complaint">
          <p>
            You may complain to the Data Protection Board of India once it has been set up and the law allows it.
            Please give us the chance to resolve it first.
          </p>
        </Callout>
      </>
    ),
  },
  {
    heading: '12. Children',
    body: (
      <p>
        Ocar is for people aged 18 and over. We do not knowingly collect data from anyone under 18 and we do not
        track or target children. If you think a child has an account, tell us and we will remove it.
      </p>
    ),
  },
  {
    heading: '13. Cookies on the website',
    body: (
      <p>
        The website uses only the cookies and browser storage it needs to keep you signed in (for example the{' '}
        <span className="font-mono text-[13px]">ocar_user_session</span> cookie). We do not use advertising or
        cross-site tracking cookies.
      </p>
    ),
  },
  {
    heading: '14. Grievance officer and contact',
    body: (
      <>
        <p>Questions, complaints and privacy requests can be sent to our Grievance Officer:</p>
        <p>
          <strong>Grievance Officer</strong>, {COMPANY.legalName}
          <br />
          {formatAddress()}
          <br />
          Email: <a href={`mailto:${COMPANY.supportEmail}?subject=Privacy%20grievance`}>{COMPANY.supportEmail}</a>
          <br />
          Phone: {COMPANY.supportPhone} ({COMPANY.supportHours})
        </p>
        <p>We acknowledge every complaint within 48 hours and aim to resolve it within 15 days.</p>
      </>
    ),
  },
  {
    heading: '15. Changes to this policy',
    body: (
      <>
        <p>
          We may update this policy when our practices or the law change. The date at the top shows the latest
          version. For material changes we will tell you in the app, by SMS or by email before they take effect, and
          ask for your consent again where the law requires it.
        </p>
        <Callout title="What changed in version 2.0 (3 November 2026)">
          <ul className="list-disc space-y-1 pl-5">
            <li>Added the crash-reporting, analytics and diagnostics tools in section 5.</li>
            <li>Added tables for the data we collect, the purposes, who receives it and retention periods.</li>
            <li>Added phone permissions, transfers outside India, safety and emergencies, and children.</li>
            <li>Updated your rights and the grievance route to match the DPDP Act.</li>
          </ul>
        </Callout>
      </>
    ),
  },
]

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro="What personal data Ocar collects, why we collect it, who we share it with, how long we keep it, and the choices you have."
      currentHref="/legal/privacy"
      sections={SECTIONS}
      summary={SUMMARY}
      version="2.0"
    />
  )
}
