import { SetMetadata } from '@nestjs/common';

export const AUTH_RATE_LIMIT_KEY = 'authRateLimit';

/**
 * Opt a route into the strict 'auth' rate limit (5 requests/minute per IP).
 *
 * This is opt-in for a reason. A throttler registered in ThrottlerModule
 * applies to EVERY route unless skipped by name, so leaving the auth limit
 * globally active silently capped public guest endpoints at 5 requests a
 * minute per IP — and every guest in one club shares a single NAT address,
 * so the sixth person to scan a QR code in a minute simply could not tip.
 *
 * Use it on credential-checking endpoints only.
 */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);
