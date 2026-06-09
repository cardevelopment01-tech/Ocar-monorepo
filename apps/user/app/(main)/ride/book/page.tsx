import { redirect } from 'next/navigation'

// Legacy page — booking now goes through /select-ride → /ride/:id
export default function BookPage() {
  redirect('/home')
}
