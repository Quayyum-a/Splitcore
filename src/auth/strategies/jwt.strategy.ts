import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('auth.jwtSecret')!,
    });
  }

  // Runs on every authenticated request. Re-checking against the database
  // (rather than trusting the token payload alone) means a deactivated
  // user is locked out immediately, not just once their existing token
  // happens to expire.
  async validate(payload: JwtPayload) {
    // Entertainers have no User row. Their token is issued by redeeming a
    // one-time link, so it is resolved against the entertainer record - and
    // re-checked on every request, so deactivating an entertainer locks them
    // out immediately rather than whenever their token happens to expire.
    if (payload.role === Role.ENTERTAINER) {
      const entertainerId = payload.entertainerId ?? payload.sub;
      const entertainer = await this.prisma.entertainer.findUnique({
        where: { id: entertainerId },
      });

      if (!entertainer || !entertainer.isActive) {
        throw new UnauthorizedException('Entertainer no longer active');
      }

      return {
        id: entertainer.id,
        entertainerId: entertainer.id,
        email: null,
        role: Role.ENTERTAINER,
        // Entertainers are not scoped to a single venue: they can perform at
        // several, and their dashboard spans all of them.
        venueId: null,
      };
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User no longer active');
    }

    return {
      id: user.id,
      userId: user.id,
      email: user.email,
      role: user.role,
      venueId: user.venueId,
    };
  }
}
