import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export default async function RootPage() {
  const cookieStore = await cookies()
  const hasSession = cookieStore.get('ocar_user_session')?.value === '1'
  redirect(hasSession ? '/home' : '/login')
}
