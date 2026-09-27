import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { KycService } from './kyc.service';
import {
  ConfirmAccountDto,
  DecideKycReviewDto,
  KycStatusResponseDto,
  SubmitBankDetailsDto,
  VerifyIdentityDto,
} from './dto/kyc.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { EntertainerScoped } from '../common/guards/entertainer-scoped.guard';

/**
 * Entertainer onboarding, following the spec's flow exactly:
 *
 *   bank details -> resolve account -> confirm holder -> identity -> VERIFIED
 *
 * Every route is entertainer-scoped: a venue admin may only act on entertainers
 * who perform at their venue, and an entertainer only on themselves.
 */
@ApiTags('Entertainer KYC')
@ApiBearerAuth()
@Controller('entertainers/:entertainerId/kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get('status')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN, Role.ENTERTAINER)
  @EntertainerScoped()
  @ApiOperation({
    summary: 'Current KYC state and the next step',
    description:
      'nextStep is derived from the record, so a client never has to work out where the ' +
      'entertainer is in the flow. The account number is returned masked to its last four digits.',
  })
  @ApiParam({ name: 'entertainerId' })
  @ApiResponse({ status: 200, type: KycStatusResponseDto })
  async status(@Param('entertainerId') id: string): Promise<KycStatusResponseDto> {
    return this.kyc.getStatus(id);
  }

  // Admin-assisted on purpose, unlike confirm-account and verify-identity
  // below. Capturing and resolving bank details asserts nothing about identity -
  // resolve-account only asks the bank a question - so a venue admin helping an
  // entertainer get started is a genuine convenience. The asymmetry is the
  // point: everything that makes a claim ABOUT the entertainer is theirs alone.
  @Post('bank-details')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN, Role.ENTERTAINER)
  @EntertainerScoped()
  @ApiOperation({
    summary: 'Step 1 - capture bank details',
    description:
      'Changing the account number or bank code clears any previous resolution, confirmation and ' +
      'verification. Otherwise someone could pass the name check on one account and then swap the ' +
      'number underneath it.',
  })
  @ApiResponse({ status: 201, type: KycStatusResponseDto })
  async bankDetails(
    @Param('entertainerId') id: string,
    @Body() dto: SubmitBankDetailsDto,
  ): Promise<KycStatusResponseDto> {
    return this.kyc.submitBankDetails(id, dto);
  }

  @Post('resolve-account')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN, Role.ENTERTAINER)
  @EntertainerScoped()
  @ApiOperation({
    summary: 'Step 2 - ask the bank who owns the account',
    description:
      "Returns the account holder's name as the BANK reports it, for the entertainer to confirm. " +
      'A rejection from the bank answers 400 and sets KYC to FAILED with the reason.',
  })
  @ApiResponse({ status: 201, type: KycStatusResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Bank details missing, or the bank could not resolve them',
  })
  async resolve(@Param('entertainerId') id: string): Promise<KycStatusResponseDto> {
    return this.kyc.resolveAccount(id);
  }

  // ENTERTAINER only, and deliberately not PLATFORM_ADMIN either.
  //
  // This is the one step whose entire meaning is "the real account holder says
  // this account is theirs". While VENUE_ADMIN could reach it, a venue admin
  // could submit bank details, resolve them, and confirm them for any
  // entertainer at their venue - their own account included - and the record
  // was indistinguishable from the entertainer having done it. An admin
  // confirming on someone's behalf is not a convenience, it is the fraud this
  // step exists to prevent.
  //
  // There is therefore no admin override. If an entertainer cannot reach the
  // link, the remedy is to get them a login link, not to confirm for them.
  @Post('confirm-account')
  @Roles(Role.ENTERTAINER)
  @EntertainerScoped()
  @ApiOperation({
    summary: 'Step 3 - confirm the resolved name is the entertainer (ENTERTAINER only)',
    description:
      'The submitted name must match what the bank returned, compared case- and spacing- ' +
      'insensitively. This is the step that makes a payout destination trusted rather than typed, ' +
      'so only the entertainer themselves can perform it - not a venue admin, and not a platform ' +
      'admin. Requires an entertainer session from POST /entertainer-auth/sessions.',
  })
  @ApiResponse({ status: 201, type: KycStatusResponseDto })
  @ApiResponse({ status: 400, description: 'Not resolved yet, or the name does not match' })
  @ApiResponse({
    status: 403,
    description: 'Only the entertainer may confirm their own account',
  })
  async confirm(
    @Param('entertainerId') id: string,
    @Body() dto: ConfirmAccountDto,
  ): Promise<KycStatusResponseDto> {
    return this.kyc.confirmAccount(id, dto.confirmedAccountName);
  }

  // ENTERTAINER only, for the same reason plus one more: submitting someone
  // else's BVN or NIN is not a thing any admin should be positioned to do, and
  // a role that can do it is a role that can be compelled or compromised into
  // doing it.
  @Post('verify-identity')
  @Roles(Role.ENTERTAINER)
  @EntertainerScoped()
  @ApiOperation({
    summary: 'Step 4 - identity verification (BVN/NIN) (ENTERTAINER only)',
    description:
      'The document number is forwarded to the provider and never stored, logged or returned - only ' +
      'the document type and the outcome are kept. If the provider cannot run the check (Paystack ' +
      'gates identity APIs behind the CAC-registered "Registered Business" tier), the entertainer ' +
      'goes to REVIEW rather than VERIFIED or FAILED, and payouts stay gated until a human decides.',
  })
  @ApiResponse({ status: 201, type: KycStatusResponseDto })
  @ApiResponse({ status: 400, description: 'The bank account has not been confirmed yet' })
  @ApiResponse({
    status: 403,
    description: 'Only the entertainer may submit their own identity document',
  })
  @ApiResponse({ status: 409, description: 'Already verified' })
  async verifyIdentity(
    @Param('entertainerId') id: string,
    @Body() dto: VerifyIdentityDto,
  ): Promise<KycStatusResponseDto> {
    return this.kyc.verifyIdentity(id, dto);
  }

  @Post('review')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({
    summary: 'Decide a REVIEW manually (PLATFORM_ADMIN only)',
    description:
      'The exit from REVIEW, which is where every entertainer lands while identity verification is ' +
      'unavailable on the connected Paystack account. Approval requires the bank account to have ' +
      'been resolved and confirmed first.',
  })
  @ApiResponse({ status: 201, type: KycStatusResponseDto })
  @ApiResponse({ status: 409, description: 'Entertainer is not in REVIEW' })
  async review(
    @Param('entertainerId') id: string,
    @Body() dto: DecideKycReviewDto,
    @Request() req: { user: { id: string } },
  ): Promise<KycStatusResponseDto> {
    return this.kyc.decideReview(id, dto.decision, dto.reason, req.user.id);
  }
}
