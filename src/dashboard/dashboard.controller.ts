import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import {
  EntertainerEarningsRowDto,
  EntertainerOverviewResponseDto,
  VenueOverviewResponseDto,
} from './dto/dashboard.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { VenueScoped } from '../common/guards/venue-scoped.guard';
import { EntertainerScoped } from '../common/guards/entertainer-scoped.guard';

/**
 * Venue-facing dashboard reads. Every route is venue-scoped, so a venue admin
 * sees only their own venue and a platform admin sees any.
 */
@ApiTags('Venue Dashboard')
@ApiBearerAuth()
@Controller('venues/:venueId')
export class VenueDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary: "Tonight's totals for a venue",
    description:
      'Tonight is the Africa/Lagos calendar day, midnight to now. totalTipsKobo is gross takings; ' +
      'pendingPayoutsKobo is a balance as it stands now (QUEUED, RETRYING or PROCESSING), not a ' +
      'figure for the window. All amounts are integer kobo.',
  })
  @ApiParam({ name: 'venueId' })
  @ApiResponse({ status: 200, type: VenueOverviewResponseDto })
  @ApiResponse({ status: 403, description: 'Access denied to this venue' })
  async overview(@Param('venueId') venueId: string): Promise<VenueOverviewResponseDto> {
    return this.dashboard.venueOverview(venueId);
  }

  @Get('entertainer-earnings')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary: 'Per-entertainer earnings at this venue (Tonight / This Week / Total)',
    description:
      "Each entertainer's own share, read from the ledger rather than from gross tips, and counting " +
      'only payments at this venue - an entertainer who also performs elsewhere does not have that ' +
      'income exposed here. This Week is a rolling 7 Lagos days including today.',
  })
  @ApiResponse({ status: 200, type: [EntertainerEarningsRowDto] })
  async entertainerEarnings(
    @Param('venueId') venueId: string,
  ): Promise<EntertainerEarningsRowDto[]> {
    return this.dashboard.venueEntertainerEarnings(venueId);
  }

  @Get('transactions')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary:
      'Transaction history for a venue (Time / Amount / Entertainer / Guest / Status / Reference)',
    description: "Newest first. A guest who chose not to be named appears as 'Anonymous'.",
  })
  @ApiResponse({ status: 200, description: 'Paginated transactions' })
  async transactions(@Param('venueId') venueId: string, @Query() query: PaginationQueryDto) {
    return this.dashboard.venueTransactions(venueId, query.limit, query.offset);
  }

  @Get('payouts')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary: 'Payout history for a venue (Entertainer / Amount / Status / Reference / Time)',
    description:
      'Payouts arising from payments at this venue, newest first. failureReason carries the ' +
      'operator-facing explanation when a transfer needs human action.',
  })
  @ApiResponse({ status: 200, description: 'Paginated payouts' })
  async payouts(@Param('venueId') venueId: string, @Query() query: PaginationQueryDto) {
    return this.dashboard.venuePayouts(venueId, query.limit, query.offset);
  }
}

/**
 * The entertainer's own dashboard.
 *
 * @EntertainerScoped() is what makes this safe: an ENTERTAINER token may only
 * ever address its own id, a venue admin only entertainers who perform at their
 * venue. There is deliberately no venue-wide financial data on any of these
 * routes.
 */
@ApiTags('Entertainer Dashboard')
@ApiBearerAuth()
@Controller('entertainers/:entertainerId')
export class EntertainerDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN, Role.ENTERTAINER)
  @EntertainerScoped()
  @ApiOperation({
    summary: 'Tonight / This Week / Total for one entertainer',
    description:
      "The entertainer's own share, summed from their ledger credits - not gross tips. Also reports " +
      'what is owed but unpaid, and what has already been transferred. Integer kobo throughout.',
  })
  @ApiParam({ name: 'entertainerId' })
  @ApiResponse({ status: 200, type: EntertainerOverviewResponseDto })
  @ApiResponse({ status: 403, description: 'Entertainers may only access their own data' })
  async overview(
    @Param('entertainerId') entertainerId: string,
  ): Promise<EntertainerOverviewResponseDto> {
    return this.dashboard.entertainerOverview(entertainerId);
  }

  @Get('transactions')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN, Role.ENTERTAINER)
  @EntertainerScoped()
  @ApiOperation({
    summary: "This entertainer's own transaction history",
    description: 'Only tips attributed to them, newest first.',
  })
  @ApiResponse({ status: 200, description: 'Paginated transactions' })
  async transactions(
    @Param('entertainerId') entertainerId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.dashboard.entertainerTransactions(entertainerId, query.limit, query.offset);
  }

  @Get('payouts')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN, Role.ENTERTAINER)
  @EntertainerScoped()
  @ApiOperation({
    summary: "This entertainer's own payout history",
    description: 'Payouts against their own payable account, newest first.',
  })
  @ApiResponse({ status: 200, description: 'Paginated payouts' })
  async payouts(@Param('entertainerId') entertainerId: string, @Query() query: PaginationQueryDto) {
    return this.dashboard.entertainerPayouts(entertainerId, query.limit, query.offset);
  }
}
