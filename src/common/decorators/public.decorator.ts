import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// The app guards authenticated by default (see AppModule's APP_GUARD
// registration). @Public() is the explicit, visible opt-out for the small
// number of routes that genuinely have no user behind them: health checks,
// login itself, and — later — the guest-facing tipping endpoints, since
// guests never have an account. Defaulting to "locked" and opting out is
// safer than defaulting to "open" and hoping every sensitive route
// remembers its own guard.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
