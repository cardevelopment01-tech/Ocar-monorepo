import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PATHS = [
  '/overview',
  '/live-map',
  '/rides',
  '/drivers',
  '/users',
  '/disputes',
  '/sos',
  '/payments',
  '/settlements',
  '/refunds',
  '/config',
  '/analytics',
  '/snapshots',
]

const PUBLIC_ONLY = ['/login']

export function middleware(request: NextRequest) {
  const hasSession =
    request.cookies.get('ocar_admin_session')?.value === '1' ||
    Boolean(request.cookies.get('ocar_admin_token')?.value)
  const path = request.nextUrl.pathname

  const isProtected = PROTECTED_PATHS.some(p => path === p || path.startsWith(p + '/'))
  const isPublicOnly = PUBLIC_ONLY.some(p => path === p || path.startsWith(p + '/'))

  if (isProtected && !hasSession) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', path)
    return NextResponse.redirect(loginUrl)
  }

  if (isPublicOnly && hasSession) {
    return NextResponse.redirect(new URL('/overview', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
