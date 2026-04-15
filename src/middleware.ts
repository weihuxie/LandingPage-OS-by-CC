import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './i18n';

export default createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

export const config = {
  // Run only on paths that need locale handling — not on /p (public pages), /api, static assets.
  matcher: ['/', '/((?!api|_next|_vercel|p|.*\\..*).*)'],
};
