import { LegalDocument, type LegalSection } from '../LegalDocument'
import { COMPANY } from '@/lib/company'

export const metadata = { title: 'Delete your Ocar account' }

const SECTIONS: LegalSection[] = [
  {
    heading: '1. Delete your account in the app',
    body: (
      <>
        <p>This applies to both the Ocar rider app and the Ocar driver app.</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Open the app and go to the Profile tab.</li>
          <li>Scroll to the bottom and tap &ldquo;Delete account&rdquo;.</li>
          <li>Confirm. You will be signed out and the account is closed straight away.</li>
        </ol>
        <p>
          The app will stop you if a ride is in progress, your wallet still holds money, or (for drivers) a payout
          is being processed. Finish or settle that first, or contact us and we will help.
        </p>
      </>
    ),
  },
  {
    heading: '2. Cannot open the app? Ask us to delete it',
    body: (
      <>
        <p>
          Email <a href={`mailto:${COMPANY.supportEmail}?subject=Delete%20my%20Ocar%20account`}>{COMPANY.supportEmail}</a> from
          any address, with the subject &ldquo;Delete my Ocar account&rdquo;. Tell us the phone number the account is
          registered under and whether it is a rider or driver account. We may call that number to confirm the request
          is yours.
        </p>
        <p>We acknowledge requests within 48 hours and complete them within 15 days.</p>
      </>
    ),
  },
  {
    heading: '3. What is deleted',
    body: (
      <p>
        Your name, phone number, email address, address and date of birth, identity numbers (Aadhaar and driving
        licence), emergency contact, bank and UPI details, saved places, notification history, push-notification
        tokens, and all signed-in sessions. Your phone number is freed, so you can register again later as a new
        user.
      </p>
    ),
  },
  {
    heading: '4. What we keep, and for how long',
    body: (
      <p>
        Ride, fare and payment records are kept for as long as financial and tax laws require, with your name and
        phone number removed. For drivers, the verification documents submitted at onboarding are kept for the limited
        period that regulatory and safety rules require, and are not used for anything else. Chat messages and
        location history connected to a safety report or dispute are kept only until it is resolved. See our{' '}
        <a href="/legal/privacy">Privacy Policy</a> for details.
      </p>
    ),
  },
]

export default function DeleteAccountPage() {
  return (
    <LegalDocument
      title="Delete your Ocar account"
      intro="How to delete your Ocar rider or driver account and the personal data in it, and what we keep."
      currentHref="/legal/delete-account"
      sections={SECTIONS}
    />
  )
}
