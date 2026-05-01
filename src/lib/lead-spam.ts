/**
 * Honeypot detection for /api/leads.
 *
 * The lead form renders a hidden `company_url` input that real users
 * never see (offset off-screen + aria-hidden + tabindex=-1). Spam bots
 * that auto-fill every input in the DOM will populate it. Any non-empty
 * string in that field is treated as bot traffic.
 *
 * Server-side check returns 200 to the bot rather than 400 — telling
 * the bot it was caught just trains the next iteration to skip the
 * field. Silent drop is the standard honeypot pattern.
 */
export function isHoneypotTriggered(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const value = (body as Record<string, unknown>).company_url;
  return typeof value === 'string' && value.trim().length > 0;
}
