import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/auth.service';

/** Long enough to walk to the back office, short enough to be useless if seen. */
const LINK_TTL_MINUTES = 30;

/**
 * A dashboard session is deliberately short. An entertainer's phone is the
 * least controlled device in this system, and re-requesting a link is cheap.
 */
const SESSION_TTL = '12h';

export interface IssuedLoginLink {
  loginUrl: string;
  /** Raw token. Returned once, never stored, never logged. */
  token: string;
  expiresAt: Date;
}

/**
 * Entertainer sign-in.
 *
 * Option A from the brief: a one-time link rather than a password. Chosen
 * because entertainers have no account today and no email on record, the people
 * involved are working a club floor rather than managing credentials, and the
 * codebase already has this exact pattern working twice - QR public tokens and
 * split-rule consent links. A password flow would mean a new account-creation
 * journey, a reset journey, and a support burden, to protect read-only access to
 * data the entertainer already knows.
 *
 * Only the SHA-256 hash of a token is stored, so a leaked database cannot be
 * used to sign in as anyone.
 */
@Injectable()
export class EntertainerAuthService {
  private readonly logger = new Logger(EntertainerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Mint a link for an entertainer. Called by a venue or platform admin, who
   * then passes it on: there is no notification channel yet (entertainers have
   * a phone number but no email, and no notifications module exists), so
   * delivery is manual and that is stated rather than papered over.
   */
  async issueLoginLink(entertainerId: string): Promise<IssuedLoginLink> {
    const entertainer = await this.prisma.entertainer.findUnique({ where: { id: entertainerId } });
    if (!entertainer) {
      throw new NotFoundException(`Entertainer ${entertainerId} not found`);
    }
    if (!entertainer.isActive) {
      throw new UnauthorizedException('This entertainer is not active');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60_000);

    // Supersede any outstanding link, so an old one that leaked stops working
    // the moment a new one is issued.
    await this.prisma.entertainerLoginToken.updateMany({
      where: { entertainerId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.entertainerLoginToken.create({
      data: { entertainerId, tokenHash: hashToken(token), expiresAt },
    });

    this.logger.log('Entertainer login link issued', { entertainerId, expiresAt });

    return { loginUrl: this.buildLoginUrl(token), token, expiresAt };
  }

  /**
   * Redeem a link for a short-lived, read-only JWT.
   *
   * Single use: the token is burned on redemption, so a link sitting in someone
   * else's message history is already spent.
   */
  async redeem(
    token: string,
  ): Promise<{ accessToken: string; entertainerId: string; stageName: string }> {
    // One message for every failure mode - expired, already used, never
    // existed - so the endpoint cannot be used to probe which links are real.
    const invalid = new UnauthorizedException('This login link is not valid or has expired.');

    const candidate = await this.prisma.entertainerLoginToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { entertainer: true },
    });
    if (!candidate) throw invalid;

    // Constant-time even though the lookup was by hash, so the comparison
    // itself never becomes the signal.
    const provided = Buffer.from(hashToken(token), 'hex');
    const stored = Buffer.from(candidate.tokenHash, 'hex');
    if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) throw invalid;

    if (candidate.consumedAt) throw invalid;
    if (candidate.expiresAt.getTime() < Date.now()) throw invalid;
    if (!candidate.entertainer.isActive) throw invalid;

    // Claim it before issuing anything. updateMany with the consumedAt guard
    // means two simultaneous taps cannot both mint a session.
    const claimed = await this.prisma.entertainerLoginToken.updateMany({
      where: { id: candidate.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) throw invalid;

    const payload: JwtPayload = {
      sub: candidate.entertainerId,
      email: '',
      role: Role.ENTERTAINER,
      entertainerId: candidate.entertainerId,
    };

    this.logger.log('Entertainer login link redeemed', {
      entertainerId: candidate.entertainerId,
    });

    return {
      accessToken: await this.jwtService.signAsync(payload, { expiresIn: SESSION_TTL }),
      entertainerId: candidate.entertainerId,
      stageName: candidate.entertainer.stageName,
    };
  }

  private buildLoginUrl(token: string): string {
    const base = (
      this.config.get<string>('FRONTEND_URL') ??
      this.config.get<string>('APP_URL') ??
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}/entertainer/login/${token}`;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
