import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { VenuePayoutAccountService } from './venue-payout-account.service';
import {
  ConfirmVenueAccountDto,
  SubmitVenueBankDetailsDto,
  VenuePayoutAccountResponseDto,
} from './dto/venue-payout-account.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { VenueScoped } from '../common/guards/venue-scoped.guard';

/**
 * Where a venue's own share gets paid.
 *
 * Three steps mirroring entertainer onboarding, minus identity verification: a
 * venue is a business vetted at onboarding, so the only open question is whether
 * the account belongs to it.
 *
 * Every route is VENUE_ADMIN (own venue) or PLATFORM_ADMIN. Note that unlike the
 * entertainer flow - where confirmation is locked to the entertainer because an
 * admin confirming on their behalf is the fraud the step prevents - here the
 * venue admin IS the account holder's representative, so them confirming their
 * own venue's account is the correct party doing it.
 */
@ApiTags('Venue Payout Account')
@ApiBearerAuth()
@Controller('venues/:venueId/payout-account')
export class VenuePayoutAccountController {
  constructor(private readonly account: VenuePayoutAccountService) {}

  @Get('status')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary: "The venue's payout account and the next step",
    description:
      'Same shape as the entertainer KYC status endpoint, so a client can drive both with one ' +
      'component. The account number is masked to its last four digits.',
  })
  @ApiParam({ name: 'venueId' })
  @ApiResponse({ status: 200, type: VenuePayoutAccountResponseDto })
  @ApiResponse({ status: 403, description: 'Access denied to this venue' })
  async status(@Param('venueId') venueId: string): Promise<VenuePayoutAccountResponseDto> {
    return this.account.getStatus(venueId);
  }

  @Post('bank-details')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary: 'Step 1 - capture the venue bank account',
    description:
      'Send bankName or bankCode (from GET /banks) plus the account number. Changing the account ' +
      'clears any previous resolution and confirmation.',
  })
  @ApiResponse({ status: 201, type: VenuePayoutAccountResponseDto })
  @ApiResponse({ status: 400, description: 'Unrecognised or ambiguous bank' })
  async bankDetails(
    @Param('venueId') venueId: string,
    @Body() dto: SubmitVenueBankDetailsDto,
  ): Promise<VenuePayoutAccountResponseDto> {
    return this.account.submitBankDetails(venueId, dto);
  }

  @Post('resolve-account')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary: 'Step 2 - ask the bank who owns the account',
    description: "Returns the account holder's name as the BANK reports it, for confirmation.",
  })
  @ApiResponse({ status: 201, type: VenuePayoutAccountResponseDto })
  @ApiResponse({ status: 400, description: 'Bank details missing, or the bank rejected them' })
  async resolve(@Param('venueId') venueId: string): Promise<VenuePayoutAccountResponseDto> {
    return this.account.resolveAccount(venueId);
  }

  @Post('confirm-account')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary: 'Step 3 - confirm the resolved name',
    description:
      "The submitted name must match what the bank returned. Once confirmed, the venue's " +
      'VENUE_PAYABLE balance becomes payable and the payout sweep will pick it up.',
  })
  @ApiResponse({ status: 201, type: VenuePayoutAccountResponseDto })
  @ApiResponse({ status: 400, description: 'Not resolved yet, or the name does not match' })
  async confirm(
    @Param('venueId') venueId: string,
    @Body() dto: ConfirmVenueAccountDto,
  ): Promise<VenuePayoutAccountResponseDto> {
    return this.account.confirmAccount(venueId, dto.confirmedAccountName);
  }
}
