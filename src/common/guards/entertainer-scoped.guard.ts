import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const ENTERTAINER_SCOPED_KEY = 'entertainerScoped';

/**
 * Marks a route whose subject is one entertainer, identified by a path
 * parameter. Companion to @VenueScoped(), which scopes by venue instead.
 *
 * Usage: @EntertainerScoped() on a controller method with an :entertainerId
 * (or :id) path parameter.
 */
export const EntertainerScoped = (paramName = 'entertainerId') =>
  SetMetadata(ENTERTAINER_SCOPED_KEY, paramName);

/**
 * Who may act on a given entertainer:
 *
 *  - PLATFORM_ADMIN: any entertainer.
 *  - VENUE_ADMIN: only entertainers linked to their own venue. Checked against
 *    venue_entertainers rather than trusted from the request, so a venue admin
 *    cannot read the earnings of someone who performs elsewhere.
 *  - ENTERTAINER: only themselves. This is the guarantee the entertainer
 *    dashboard rests on.
 *
 * Denies by default: an unrecognised role gets nothing.
 */
@Injectable()
export class EntertainerScopedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const paramName = this.reflector.getAllAndOverride<string>(ENTERTAINER_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!paramName) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const targetId: string | undefined = request.params?.[paramName] ?? request.params?.id;

    if (!targetId) {
      throw new ForbiddenException('Entertainer ID required for this operation');
    }
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.role === Role.PLATFORM_ADMIN) {
      return true;
    }

    if (user.role === Role.ENTERTAINER) {
      if (user.entertainerId !== targetId) {
        throw new ForbiddenException('Entertainers may only access their own data');
      }
      return true;
    }

    if (user.role === Role.VENUE_ADMIN) {
      if (!user.venueId) {
        throw new ForbiddenException('Venue admin is not assigned to a venue');
      }
      const link = await this.prisma.venueEntertainer.findFirst({
        where: { venueId: user.venueId, entertainerId: targetId },
        select: { id: true },
      });
      if (!link) {
        throw new ForbiddenException('This entertainer does not perform at your venue');
      }
      return true;
    }

    throw new ForbiddenException('Access denied');
  }
}
