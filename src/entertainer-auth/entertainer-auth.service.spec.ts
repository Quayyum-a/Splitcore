import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EntertainerAuthService } from './entertainer-auth.service';

const TOKEN = 'a'.repeat(64);
const HASH = createHash('sha256').update(TOKEN).digest('hex');

function buildHarness(config: Record<string, string | undefined> = {}) {
  const prisma = {
    entertainer: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'ent-1', stageName: 'DJ Neptune', isActive: true }),
    },
    entertainerLoginToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const configService = { get: jest.fn((k: string) => config[k]) } as unknown as ConfigService;

  const service = new EntertainerAuthService(
    prisma as unknown as PrismaService,
    jwtService as unknown as JwtService,
    configService,
  );
  return { service, prisma, jwtService };
}

describe('EntertainerAuthService.issueLoginLink', () => {
  it('builds the link on the frontend origin', async () => {
    const h = buildHarness({ FRONTEND_URL: 'https://splitcore-app.netlify.app' });

    const result = await h.service.issueLoginLink('ent-1');

    expect(result.loginUrl).toBe(
      `https://splitcore-app.netlify.app/entertainer/login/${result.token}`,
    );
  });

  // Only the hash is persisted, so a leaked database cannot be used to sign in.
  it('stores only a hash of the token', async () => {
    const h = buildHarness();

    const result = await h.service.issueLoginLink('ent-1');

    const stored = h.prisma.entertainerLoginToken.create.mock.calls[0][0].data.tokenHash;
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(result.token);
    expect(stored).toBe(createHash('sha256').update(result.token).digest('hex'));
  });

  // An old link that leaked stops working the moment a new one is issued.
  it('supersedes any outstanding link', async () => {
    const h = buildHarness();

    await h.service.issueLoginLink('ent-1');

    expect(h.prisma.entertainerLoginToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entertainerId: 'ent-1', consumedAt: null } }),
    );
  });

  it('expires in 30 minutes', async () => {
    const h = buildHarness();

    const result = await h.service.issueLoginLink('ent-1');

    const minutes = (result.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it('404s for an unknown entertainer', async () => {
    const h = buildHarness();
    h.prisma.entertainer.findUnique.mockResolvedValue(null);

    await expect(h.service.issueLoginLink('nope')).rejects.toThrow(NotFoundException);
  });

  it('refuses an inactive entertainer', async () => {
    const h = buildHarness();
    h.prisma.entertainer.findUnique.mockResolvedValue({ id: 'ent-1', isActive: false });

    await expect(h.service.issueLoginLink('ent-1')).rejects.toThrow(UnauthorizedException);
  });
});

describe('EntertainerAuthService.redeem', () => {
  function withValidToken(h: ReturnType<typeof buildHarness>, overrides = {}) {
    h.prisma.entertainerLoginToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      entertainerId: 'ent-1',
      tokenHash: HASH,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      entertainer: { id: 'ent-1', stageName: 'DJ Neptune', isActive: true },
      ...overrides,
    });
  }

  it('issues an ENTERTAINER-scoped token carrying the entertainer id', async () => {
    const h = buildHarness();
    withValidToken(h);

    const result = await h.service.redeem(TOKEN);

    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      entertainerId: 'ent-1',
      stageName: 'DJ Neptune',
    });
    expect(h.jwtService.signAsync.mock.calls[0][0]).toMatchObject({
      sub: 'ent-1',
      role: 'ENTERTAINER',
      entertainerId: 'ent-1',
    });
  });

  it('issues a short-lived session rather than the default expiry', async () => {
    const h = buildHarness();
    withValidToken(h);

    await h.service.redeem(TOKEN);

    expect(h.jwtService.signAsync.mock.calls[0][1]).toEqual({ expiresIn: '12h' });
  });

  // Single use: a link sitting in a message history is already spent.
  it('burns the token on redemption', async () => {
    const h = buildHarness();
    withValidToken(h);

    await h.service.redeem(TOKEN);

    expect(h.prisma.entertainerLoginToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tok-1', consumedAt: null } }),
    );
  });

  it('rejects a token that has already been used', async () => {
    const h = buildHarness();
    withValidToken(h, { consumedAt: new Date() });

    await expect(h.service.redeem(TOKEN)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const h = buildHarness();
    withValidToken(h, { expiresAt: new Date(Date.now() - 1000) });

    await expect(h.service.redeem(TOKEN)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token for an entertainer who has been deactivated', async () => {
    const h = buildHarness();
    withValidToken(h, { entertainer: { id: 'ent-1', stageName: 'X', isActive: false } });

    await expect(h.service.redeem(TOKEN)).rejects.toThrow(UnauthorizedException);
  });

  // Two simultaneous taps must not both mint a session.
  it('rejects the loser of a concurrent redemption race', async () => {
    const h = buildHarness();
    withValidToken(h);
    h.prisma.entertainerLoginToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(h.service.redeem(TOKEN)).rejects.toThrow(UnauthorizedException);
    expect(h.jwtService.signAsync).not.toHaveBeenCalled();
  });

  // Every failure mode answers identically, so the endpoint cannot be used to
  // probe which links are real.
  it('gives an unknown, an expired and a spent token the identical error', async () => {
    const h = buildHarness();

    h.prisma.entertainerLoginToken.findUnique.mockResolvedValue(null);
    const unknown = await h.service.redeem(TOKEN).catch((e) => e);

    withValidToken(h, { expiresAt: new Date(Date.now() - 1) });
    const expired = await h.service.redeem(TOKEN).catch((e) => e);

    withValidToken(h, { consumedAt: new Date() });
    const spent = await h.service.redeem(TOKEN).catch((e) => e);

    expect(unknown.message).toBe(expired.message);
    expect(expired.message).toBe(spent.message);
    expect(unknown.getStatus()).toBe(spent.getStatus());
  });
});
