/**
 * Unit tests for rate-limit scoping.
 *
 * The strict 'auth' limit was once registered globally, which quietly capped
 * every public route — including the guest QR scan — at five requests a
 * minute per IP. These pin the opt-in model that replaced it.
 */

import { ExecutionContext } from '@nestjs/common';
import { ThrottlerOptions } from '@nestjs/throttler';
import { AUTH_RATE_LIMIT_KEY, AuthRateLimit } from './auth-rate-limit.decorator';
import { getThrottlerModuleOptions, throttlerConfig } from './throttler.config';

class DecoratedController {
  @AuthRateLimit()
  login() {}

  scanQrCode() {}
}

function contextFor(handler: (...args: never[]) => unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => DecoratedController,
  } as unknown as ExecutionContext;
}

function throttlerNamed(name: string): ThrottlerOptions {
  const options = getThrottlerModuleOptions() as { throttlers: ThrottlerOptions[] };
  return options.throttlers.find((t) => t.name === name)!;
}

describe('AuthRateLimit decorator', () => {
  it('marks the handler it decorates', () => {
    expect(Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, DecoratedController.prototype.login)).toBe(
      true,
    );
  });

  it('leaves undecorated handlers unmarked', () => {
    expect(
      Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, DecoratedController.prototype.scanQrCode),
    ).toBeUndefined();
  });
});

describe('throttler configuration', () => {
  it('registers a general limit that applies everywhere', () => {
    const general = throttlerNamed('default');
    expect(general.limit).toBe(throttlerConfig.default.limit);
    expect(general.skipIf).toBeUndefined();
  });

  it('applies the strict limit to a route that opts in', () => {
    const auth = throttlerNamed('auth');
    expect(auth.limit).toBe(throttlerConfig.auth.limit);
    expect(auth.skipIf!(contextFor(DecoratedController.prototype.login))).toBe(false);
  });

  it('skips the strict limit on a route that does not opt in', () => {
    const auth = throttlerNamed('auth');
    expect(auth.skipIf!(contextFor(DecoratedController.prototype.scanQrCode))).toBe(true);
  });
});
