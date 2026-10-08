import type { CaptureSpec } from '@/authkit/webview-capture';
import type { HttpProviderSpec } from '@/core/spec-engine';

/** Cookies that carry a Cursor dashboard session (any one is enough). */
export const CURSOR_COOKIES = [
  'WorkosCursorSessionToken',
  '__Secure-next-auth.session-token',
  'next-auth.session-token',
];

export const cursorCapture: CaptureSpec = {
  // English dashboard path: localized /cn/dashboard URLs have been reported to break the API.
  loginUrl: 'https://cursor.com/dashboard',
  cookieDomains: ['cursor.com'],
  signInDomains: ['authkit.app'],
  anyOfCookies: CURSOR_COOKIES,
  loggedOutUrlHints: ['/api/auth/login', 'authkit.app', '/sign-in'],
};

/**
 * Cursor dashboard usage. GET /api/usage-summary is an internal endpoint used by the website.
 * Shape (from community reports, ⚠ verify with `probe cursor`): billingCycleStart/End,
 * membershipType, individualUsage.plan.{used,limit,remaining}, individualUsage.onDemand.{...}.
 * The unit of used/limit is not documented (cents of API usage), so only the ratio is used.
 */
export const cursorSpec: HttpProviderSpec = {
  id: 'cursor',
  auth: { type: 'cookie', names: CURSOR_COOKIES },
  forbiddenIsAuth: true,
  requests: [
    {
      name: 'summary',
      url: 'https://cursor.com/api/usage-summary',
      headers: { Origin: 'https://cursor.com', Referer: 'https://cursor.com/dashboard' },
    },
  ],
  plan: { from: 'summary', path: 'membershipType' },
  // the membership renews when the billing cycle ends
  renewsAt: { from: 'summary', path: 'billingCycleEnd' },
  meters: [
    {
      id: 'monthly',
      label: 'Monthly',
      kind: 'percent',
      from: 'summary',
      percent: { mul: [{ div: ['individualUsage.plan.used', 'individualUsage.plan.limit'] }, 100] },
      resetsAt: 'billingCycleEnd',
    },
    {
      id: 'on_demand',
      label: 'On-demand',
      kind: 'percent',
      from: 'summary',
      percent: {
        mul: [{ div: ['individualUsage.onDemand.used', 'individualUsage.onDemand.limit'] }, 100],
      },
      resetsAt: 'billingCycleEnd',
    },
  ],
};
