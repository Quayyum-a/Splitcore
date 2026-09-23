/**
 * Example usage of @VenueScoped() decorator
 * 
 * This file demonstrates how to use the VenueScopedGuard and @VenueScoped() decorator
 * in controller methods to enforce venue-scoped access control.
 * 
 * DO NOT import this file in your application - it's for documentation purposes only.
 */

import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { Roles } from '../decorators/roles.decorator';
import { VenueScoped } from './venue-scoped.guard';
import { Role } from '@prisma/client';

// Example 1: Venue admin can only access their own venue
@Controller('venues')
export class ExampleVenuesController {
  /**
   * GET /venues/:venueId
   * 
   * Both PLATFORM_ADMIN and VENUE_ADMIN can call this endpoint.
   * - PLATFORM_ADMIN: Can view any venue
   * - VENUE_ADMIN: Can only view their assigned venue
   * 
   * The @VenueScoped() decorator extracts venueId from params.venueId
   * and validates venue access.
   */
  @Get(':venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  async getVenue(@Param('venueId') venueId: string) {
    // If execution reaches here, the user has access to this venue
    return { venueId, message: 'Venue access granted' };
  }

  /**
   * PATCH /venues/:venueId
   * 
   * Both PLATFORM_ADMIN and VENUE_ADMIN can call this endpoint.
   * - PLATFORM_ADMIN: Can update any venue
   * - VENUE_ADMIN: Can only update their assigned venue
   * 
   * The @VenueScoped() decorator extracts venueId from params.venueId
   */
  @Patch(':venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  async updateVenue(
    @Param('venueId') venueId: string,
    @Body() updateDto: any,
  ) {
    return { venueId, message: 'Venue updated successfully' };
  }
}

// Example 2: Creating resources that belong to a venue
@Controller('entertainers')
export class ExampleEntertainersController {
  /**
   * POST /entertainers/:entertainerId/venues/:venueId
   * 
   * Links an entertainer to a venue.
   * - PLATFORM_ADMIN: Can link to any venue
   * - VENUE_ADMIN: Can only link to their assigned venue
   * 
   * The @VenueScoped() decorator extracts venueId from params.venueId
   */
  @Post(':entertainerId/venues/:venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  async linkEntertainerToVenue(
    @Param('entertainerId') entertainerId: string,
    @Param('venueId') venueId: string,
  ) {
    return { entertainerId, venueId, message: 'Linked successfully' };
  }
}

// Example 3: Creating resources with venueId in the body
@Controller('qr-codes')
export class ExampleQrCodesController {
  /**
   * POST /qr-codes
   * 
   * Creates a QR code for a venue.
   * - PLATFORM_ADMIN: Can create QR codes for any venue
   * - VENUE_ADMIN: Can only create QR codes for their assigned venue
   * 
   * The @VenueScoped() decorator extracts venueId from body.venueId
   */
  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  async createQrCode(@Body() createDto: { venueId: string; location: string }) {
    return { venueId: createDto.venueId, message: 'QR code created' };
  }
}

// Example 4: Platform admin only endpoint (no venue scoping needed)
@Controller('venues')
export class ExamplePlatformAdminController {
  /**
   * POST /venues
   * 
   * Only PLATFORM_ADMIN can create venues.
   * No @VenueScoped() decorator needed because:
   * 1. This creates a new venue (no existing venueId to check)
   * 2. Only PLATFORM_ADMIN role is allowed
   */
  @Post()
  @Roles(Role.PLATFORM_ADMIN)
  async createVenue(@Body() createDto: any) {
    return { message: 'Venue created' };
  }
}

/**
 * Error Scenarios:
 * 
 * Scenario 1: Venue admin tries to access another venue
 * User: { role: VENUE_ADMIN, venueId: 'venue-1' }
 * Request: GET /venues/venue-2
 * Result: 403 Forbidden - "Access denied to this venue"
 * 
 * Scenario 2: Venue admin sends request without venueId
 * User: { role: VENUE_ADMIN, venueId: 'venue-1' }
 * Request: POST /some-endpoint (no venueId in params or body)
 * Result: 403 Forbidden - "Venue ID required for venue-scoped operation"
 * 
 * Scenario 3: Platform admin can access any venue
 * User: { role: PLATFORM_ADMIN, venueId: null }
 * Request: GET /venues/any-venue-id
 * Result: 200 OK - access granted
 */
