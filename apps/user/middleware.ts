import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED = ['/home', '/ride', '/history', '/wallet', '/profile', '/search']
const PUBLIC_ONLY = ['/login']

export function middleware(request: NextRequest) {
  const token = request.cookies.get('ocar_user_token')?.value
  const path = request.nextUrl.pathname

  const isProtected = PROTECTED.some(p => path.startsWith(p))
  const isPublicOnly = PUBLIC_ONLY.some(p => path.startsWith(p))

  if (isProtected && !token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isPublicOnly && token) {
    return NextResponse.redirect(new URL('/home', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
