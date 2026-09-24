import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const VENUE_SCOPED_KEY = 'venueScoped';

/**
 * Decorator to mark controller methods as venue-scoped.
 * When applied, the VenueScopedGuard will enforce that:
 * - PLATFORM_ADMIN users can access any venue
 * - VENUE_ADMIN users can only access their assigned venue
 *
 * Usage: @VenueScoped() on a controller method
 */
export const VenueScoped = () => SetMetadata(VENUE_SCOPED_KEY, true);

/**
 * Guard that enforces venue-scoped access control.
 *
 * Runs after JwtAuthGuard and RolesGuard to ensure user is authenticated
 * and has appropriate role. Then validates venue access:
 *
 * - If route is not marked with @VenueScoped(), guard passes through
 * - PLATFORM_ADMIN users bypass venue scoping (access any venue)
 * - VENUE_ADMIN users must access only their assigned venue
 * - Throws 403 Forbidden for venue scope violations
 *
 * The guard extracts venueId from:
 * 1. request.params.venueId (path parameter)
 * 2. request.body.venueId (body field)
 */
@Injectable()
export class VenueScopedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if the route is marked as venue-scoped
    const isVenueScoped = this.reflector.getAllAndOverride<boolean>(VENUE_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If not venue-scoped, allow access
    if (!isVenueScoped) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Platform admins bypass venue scoping - they can access any venue
    if (user.role === Role.PLATFORM_ADMIN) {
      return true;
    }

    // Venue admins must access only their assigned venue
    if (user.role === Role.VENUE_ADMIN) {
      // Extract venueId from params or body
      const resourceVenueId = request.params.venueId || request.body?.venueId;

      if (!resourceVenueId) {
        throw new ForbiddenException('Venue ID required for venue-scoped operation');
      }

      if (user.venueId !== resourceVenueId) {
        throw new ForbiddenException('Access denied to this venue');
      }

      return true;
    }

    // Any other role attempting venue-scoped operation
    throw new ForbiddenException('Insufficient permissions');
  }
}
