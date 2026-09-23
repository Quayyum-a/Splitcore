import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { VenueScopedGuard, VENUE_SCOPED_KEY } from './venue-scoped.guard';

describe('VenueScopedGuard', () => {
  let guard: VenueScopedGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new VenueScopedGuard(reflector);
  });

  const createMockExecutionContext = (
    isVenueScoped: boolean,
    user: { role: Role; venueId?: string | null },
    params: Record<string, string> = {},
    body: Record<string, any> = {},
  ): ExecutionContext => {
    const mockRequest = {
      user,
      params,
      body,
    };

    const mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;

    // Mock the reflector to return whether the route is venue-scoped
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(isVenueScoped);

    return mockContext;
  };

  describe('when route is not venue-scoped', () => {
    it('should allow access regardless of user role', () => {
      const context = createMockExecutionContext(
        false,
        { role: Role.VENUE_ADMIN, venueId: 'venue-1' },
        { venueId: 'venue-2' },
      );

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('when route is venue-scoped', () => {
    describe('PLATFORM_ADMIN role', () => {
      it('should allow access to any venue', () => {
        const context = createMockExecutionContext(
          true,
          { role: Role.PLATFORM_ADMIN, venueId: null },
          { venueId: 'any-venue-id' },
        );

        expect(guard.canActivate(context)).toBe(true);
      });

      it('should allow access even when venueId is missing from request', () => {
        const context = createMockExecutionContext(
          true,
          { role: Role.PLATFORM_ADMIN, venueId: null },
          {},
        );

        expect(guard.canActivate(context)).toBe(true);
      });
    });

    describe('VENUE_ADMIN role', () => {
      it('should allow access when venueId matches user venueId (from params)', () => {
        const context = createMockExecutionContext(
          true,
          { role: Role.VENUE_ADMIN, venueId: 'venue-1' },
          { venueId: 'venue-1' },
        );

        expect(guard.canActivate(context)).toBe(true);
      });

      it('should allow access when venueId matches user venueId (from body)', () => {
        const context = createMockExecutionContext(
          true,
          { role: Role.VENUE_ADMIN, venueId: 'venue-1' },
          {},
          { venueId: 'venue-1' },
        );

        expect(guard.canActivate(context)).toBe(true);
      });

      it('should prioritize params over body when both are present', () => {
        const context = createMockExecutionContext(
          true,
          { role: Role.VENUE_ADMIN, venueId: 'venue-1' },
          { venueId: 'venue-1' },
          { venueId: 'venue-2' },
        );

        expect(guard.canActivate(context)).toBe(true);
      });

      it('should throw ForbiddenException when venueId does not match', () => {
        const context = createMockExecutionContext(
          true,
          { role: Role.VENUE_ADMIN, venueId: 'venue-1' },
          { venueId: 'venue-2' },
        );

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
        expect(() => guard.canActivate(context)).toThrow(
          'Access denied to this venue',
        );
      });

      it('should throw ForbiddenException when venueId is missing from request', () => {
        const context = createMockExecutionContext(
          true,
          { role: Role.VENUE_ADMIN, venueId: 'venue-1' },
          {},
          {},
        );

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
        expect(() => guard.canActivate(context)).toThrow(
          'Venue ID required for venue-scoped operation',
        );
      });

      it('should throw ForbiddenException when user has no venueId assigned', () => {
        const context = createMockExecutionContext(
          true,
          { role: Role.VENUE_ADMIN, venueId: null },
          { venueId: 'venue-1' },
        );

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
        expect(() => guard.canActivate(context)).toThrow(
          'Access denied to this venue',
        );
      });
    });

    describe('other roles', () => {
      it('should throw ForbiddenException for unsupported roles', () => {
        const context = createMockExecutionContext(
          true,
          { role: 'UNKNOWN_ROLE' as Role, venueId: null },
          { venueId: 'venue-1' },
        );

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
        expect(() => guard.canActivate(context)).toThrow(
          'Insufficient permissions',
        );
      });
    });
  });

  describe('reflector integration', () => {
    it('should use reflector to check VENUE_SCOPED_KEY metadata', () => {
      const context = createMockExecutionContext(
        false,
        { role: Role.PLATFORM_ADMIN, venueId: null },
      );

      const spy = jest.spyOn(reflector, 'getAllAndOverride');

      guard.canActivate(context);

      expect(spy).toHaveBeenCalledWith(VENUE_SCOPED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });
  });
});
