/**
 * Unit tests for the JWT strategy's validate step, which runs on every
 * authenticated request.
 */

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

function build() {
  const prisma = { user: { findUnique: jest.fn() } };
  const config = {
    get: jest.fn(() => 'a-test-secret-that-is-long-enough-to-pass'),
  } as unknown as ConfigService;
  const strategy = new JwtStrategy(config, prisma as unknown as PrismaService);
  return { strategy, prisma };
}

const PAYLOAD = { sub: 'user-1', email: 'admin@splitcore.dev', role: 'VENUE_ADMIN' };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'admin@splitcore.dev',
    passwordHash: 'hash',
    role: 'VENUE_ADMIN',
    isActive: true,
    venueId: 'venue-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

describe('JwtStrategy.validate', () => {
  it('returns the request user, including the venue scope, for an active account', async () => {
    const { strategy, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(makeUser());

    await expect(strategy.validate(PAYLOAD)).resolves.toEqual({
      id: 'user-1',
      userId: 'user-1',
      email: 'admin@splitcore.dev',
      role: 'VENUE_ADMIN',
      venueId: 'venue-1',
    });
  });

  it('re-reads the database rather than trusting the token payload', async () => {
    // A deactivated user must be locked out immediately, not whenever their
    // existing token happens to expire.
    const { strategy, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));

    await expect(strategy.validate(PAYLOAD)).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('rejects a token for a user that no longer exists', async () => {
    const { strategy, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(PAYLOAD)).rejects.toThrow('User no longer active');
  });

  it('never exposes the password hash on the request user', async () => {
    const { strategy, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(makeUser());

    const result = await strategy.validate(PAYLOAD);

    expect(Object.keys(result)).not.toContain('passwordHash');
  });
});
