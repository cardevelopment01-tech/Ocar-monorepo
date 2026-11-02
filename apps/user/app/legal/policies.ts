// The five public policies, in reading order. Used by the policy switcher, the /legal index and the
// previous/next links, so a new policy only has to be added here.
export const POLICIES = [
  {
    href: '/legal/terms',
    updated: '3 November 2026',
    label: 'Terms and Conditions',
    description: 'The rules for riding and driving with Ocar: accounts, bookings, fares, payments and conduct.',
  },
  {
    href: '/legal/privacy',
    updated: '3 November 2026',
    label: 'Privacy Policy',
    description: 'What personal data we collect, why, who we share it with, how long we keep it, and your rights.',
  },
  {
    href: '/legal/refund-cancellation',
    updated: '25 September 2026',
    label: 'Refund and Cancellation',
    description: 'When a ride can be cancelled for free, when a fee applies, and how refunds are made.',
  },
  {
    href: '/legal/shipping',
    updated: '25 September 2026',
    label: 'Shipping and Delivery',
    description: 'Ocar is a ride service and ships nothing. How the service is delivered and when.',
  },
  {
    href: '/legal/delete-account',
    updated: '25 September 2026',
    label: 'Delete your account',
    description: 'How to delete your rider or driver account and the personal data in it, and what we keep.',
  },
] as const

export type PolicyHref = (typeof POLICIES)[number]['href']
