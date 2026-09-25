import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, SafeUser } from './auth.service';
import { AuthController } from './auth.controller';

describe('AuthService.hashPassword', () => {
  it('produces a hash that verifies against the original password', async () => {
    const hash = await AuthService.hashPassword('correct-horse-battery-staple');
    await expect(bcrypt.compare('correct-horse-battery-staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password against the hash', async () => {
    const hash = await AuthService.hashPassword('correct-horse-battery-staple');
    await expect(bcrypt.compare('wrong-password', hash)).resolves.toBe(false);
  });
});

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'admin@splitcore.dev',
    passwordHash: 'stored-hash',
    role: 'PLATFORM_ADMIN',
    isActive: true,
    venueId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

function buildAuth() {
  const prisma = { user: { findUnique: jest.fn() } };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwtService as unknown as JwtService,
  );
  return { service, prisma, jwtService };
}

describe('AuthService.validateUser', () => {
  // Real hashes rather than a mocked bcrypt: the comparison is the point of
  // the method, and bcryptjs's exports cannot be redefined by a spy anyway.
  const PASSWORD = 'correct-horse-battery-staple';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await AuthService.hashPassword(PASSWORD);
  });

  it('returns the user without its password hash on a correct password', async () => {
    const { service, prisma } = buildAuth();
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));

    const result = (await service.validateUser('admin@splitcore.dev', PASSWORD)) as SafeUser & {
      passwordHash?: string;
    };

    expect(result.id).toBe('user-1');
    expect(result.passwordHash).toBeUndefined();
  });

  it('rejects a wrong password', async () => {
    const { service, prisma } = buildAuth();
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));

    await expect(service.validateUser('admin@splitcore.dev', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a deactivated account even with the right password', async () => {
    const { service, prisma } = buildAuth();
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, isActive: false }));

    await expect(service.validateUser('admin@splitcore.dev', PASSWORD)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('gives an unknown email and a wrong password the identical error', async () => {
    // Distinguishing them would tell an attacker which emails are registered.
    const { service, prisma } = buildAuth();

    prisma.user.findUnique.mockResolvedValue(null);
    const unknownEmail = await service.validateUser('nobody@example.com', 'x').catch((e) => e);

    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
    const wrongPassword = await service
      .validateUser('admin@splitcore.dev', 'wrong')
      .catch((e) => e);

    expect(unknownEmail.message).toBe(wrongPassword.message);
    expect(unknownEmail.getStatus()).toBe(wrongPassword.getStatus());
  });
});

describe('AuthService.login', () => {
  it('signs a token carrying the subject, email and role', async () => {
    const { service, jwtService } = buildAuth();

    await expect(service.login(makeUser() as SafeUser)).resolves.toEqual({
      accessToken: 'signed.jwt.token',
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'admin@splitcore.dev',
      role: 'PLATFORM_ADMIN',
    });
  });

  it('never puts the password hash in the token payload', async () => {
    const { service, jwtService } = buildAuth();

    await service.login(makeUser() as SafeUser);

    expect(Object.keys(jwtService.signAsync.mock.calls[0][0])).not.toContain('passwordHash');
  });
});

describe('AuthController.login', () => {
  it('validates the credentials before issuing a token', async () => {
    const authService = {
      validateUser: jest.fn().mockResolvedValue(makeUser()),
      login: jest.fn().mockResolvedValue({ accessToken: 'signed.jwt.token' }),
    };
    const controller = new AuthController(authService as unknown as AuthService);

    await expect(
      controller.login({ email: 'admin@splitcore.dev', password: 'right' }),
    ).resolves.toEqual({ accessToken: 'signed.jwt.token' });

    expect(authService.validateUser.mock.invocationCallOrder[0]).toBeLessThan(
      authService.login.mock.invocationCallOrder[0],
    );
  });

  it('does not issue a token when validation fails', async () => {
    const authService = {
      validateUser: jest.fn().mockRejectedValue(new UnauthorizedException()),
      login: jest.fn(),
    };
    const controller = new AuthController(authService as unknown as AuthService);

    await expect(
      controller.login({ email: 'admin@splitcore.dev', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(authService.login).not.toHaveBeenCalled();
  });
});
