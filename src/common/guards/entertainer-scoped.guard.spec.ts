import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntertainerScopedGuard } from './entertainer-scoped.guard';

function contextFor(user: unknown, params: Record<string, string> = {}): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;
}

// `marked: null` means the route carries no @EntertainerScoped() at all.
// Passing `undefined` would silently pick up the default instead.
function buildGuard(marked: string | null = 'entertainerId', linked = true) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(marked ?? undefined),
  } as unknown as Reflector;
  const prisma = {
    venueEntertainer: {
      findFirst: jest.fn().mockResolvedValue(linked ? { id: 'link-1' } : null),
    },
  };
  const guard = new EntertainerScopedGuard(reflector, prisma as unknown as PrismaService);
  return { guard, prisma };
}

describe('EntertainerScopedGuard', () => {
  it('passes through routes that are not marked', async () => {
    const { guard } = buildGuard(null);

    await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
  });

  it('lets a platform admin address any entertainer', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(contextFor({ role: Role.PLATFORM_ADMIN }, { entertainerId: 'ent-9' })),
    ).resolves.toBe(true);
  });

  // The guarantee the entertainer dashboard rests on.
  it('lets an entertainer address only themselves', async () => {
    const { guard } = buildGuard();
    const user = { role: Role.ENTERTAINER, entertainerId: 'ent-1' };

    await expect(guard.canActivate(contextFor(user, { entertainerId: 'ent-1' }))).resolves.toBe(
      true,
    );
    await expect(guard.canActivate(contextFor(user, { entertainerId: 'ent-2' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets a venue admin address an entertainer who performs at their venue', async () => {
    const { guard, prisma } = buildGuard('entertainerId', true);

    await expect(
      guard.canActivate(
        contextFor({ role: Role.VENUE_ADMIN, venueId: 'venue-1' }, { entertainerId: 'ent-1' }),
      ),
    ).resolves.toBe(true);
    expect(prisma.venueEntertainer.findFirst.mock.calls[0][0].where).toEqual({
      venueId: 'venue-1',
      entertainerId: 'ent-1',
    });
  });

  // Checked against the link table rather than trusted from the request, so a
  // venue admin cannot read the earnings of someone who performs elsewhere.
  it('stops a venue admin addressing an entertainer from another venue', async () => {
    const { guard } = buildGuard('entertainerId', false);

    await expect(
      guard.canActivate(
        contextFor({ role: Role.VENUE_ADMIN, venueId: 'venue-1' }, { entertainerId: 'ent-9' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('stops a venue admin with no venue assigned', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(
        contextFor({ role: Role.VENUE_ADMIN, venueId: null }, { entertainerId: 'ent-1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('falls back to the :id parameter when that is what the route uses', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(contextFor({ role: Role.PLATFORM_ADMIN }, { id: 'ent-1' })),
    ).resolves.toBe(true);
  });

  it('refuses when no entertainer id is present at all', async () => {
    const { guard } = buildGuard();

    await expect(guard.canActivate(contextFor({ role: Role.PLATFORM_ADMIN }, {}))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses an unauthenticated request', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(contextFor(undefined, { entertainerId: 'ent-1' })),
    ).rejects.toThrow(ForbiddenException);
  });

  // Denies by default: a role nobody thought about gets nothing.
  it('refuses an unrecognised role', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(contextFor({ role: 'SOMETHING_NEW' }, { entertainerId: 'ent-1' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
