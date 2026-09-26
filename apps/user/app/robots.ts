import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/home', '/ride', '/history', '/wallet', '/profile', '/search', '/select-ride', '/onboarding'],
    },
    sitemap: 'https://ocarindia.com/sitemap.xml',
  }
}
