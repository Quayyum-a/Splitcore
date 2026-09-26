import { Controller, Get, Post, Body, Param, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Role, SplitRule } from '@prisma/client';
import { SplitRulesService } from './split-rules.service';
import { CreateSplitRuleDto } from './dto/create-split-rule.dto';
import { OverrideSplitRuleDto } from './dto/override-split-rule.dto';
import { RespondSplitRuleDto, SplitRuleTermsDto } from './dto/respond-split-rule.dto';
import { SplitRuleProposalResponseDto, SplitRuleResponseDto } from './dto/split-rule-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { VenueScoped } from '../common/guards/venue-scoped.guard';

@ApiTags('Split Rules')
@Controller('split-rules')
export class SplitRulesController {
  constructor(
    private readonly splitRulesService: SplitRulesService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({
    summary: 'Propose a venue/entertainer split (does NOT take effect yet)',
    description:
      "The venue proposes only its own and the entertainer's shares, which must sum to " +
      '10000 minus the platform fee (see GET /platform/settings). A payload containing ' +
      "platformBps is rejected with 400 — the platform's cut is server-side only. The " +
      'rule is created PENDING_ENTERTAINER_APPROVAL and does not divide any money until ' +
      'the entertainer accepts it via the returned consentUrl.',
  })
  @ApiResponse({ status: 201, type: SplitRuleProposalResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Shares do not sum correctly, platformBps was supplied, or entertainer is not linked to the venue',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  async propose(
    @Body() dto: CreateSplitRuleDto,
    @Request() req: { user: { id: string } },
  ): Promise<SplitRuleProposalResponseDto> {
    const { rule, consentToken } = await this.splitRulesService.propose(dto, req.user.id);
    return {
      ...toResponse(rule),
      consentToken,
      consentUrl: this.buildConsentUrl(rule.id, consentToken),
    };
  }

  @Post('override')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({
    summary: 'Force-set a complete split rule (PLATFORM_ADMIN only)',
    description:
      'Bypasses entertainer consent and takes effect immediately. For genuine ' +
      'operational necessity such as dispute resolution. The rule is stamped ' +
      'origin=ADMIN_OVERRIDE and the reason is written to the immutable audit trail, so ' +
      'it can never be mistaken for terms an entertainer agreed to.',
  })
  @ApiResponse({ status: 201, type: SplitRuleResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden - PLATFORM_ADMIN only' })
  async override(
    @Body() dto: OverrideSplitRuleDto,
    @Request() req: { user: { id: string } },
  ): Promise<SplitRuleResponseDto> {
    return toResponse(await this.splitRulesService.override(dto, req.user.id));
  }

  // Consent needs no login, the same way tipping needs no login: the token is
  // the authorization. Entertainers have no accounts (Phase 7), and requiring
  // one to agree terms would mean nobody ever agrees any.
  @Get(':id/respond/:token')
  @Public()
  @ApiOperation({
    summary: 'Read the terms being proposed to you (no login)',
    description:
      'Returns the proposed shares as plain percentages with a worked example. An ' +
      'unknown id, a wrong token and an already-answered proposal all return the same ' +
      '404, so this cannot be used to discover which proposals exist.',
  })
  @ApiParam({ name: 'id', description: 'Split rule id' })
  @ApiParam({ name: 'token', description: 'Consent token from the proposal response' })
  @ApiResponse({ status: 200, type: SplitRuleTermsDto })
  @ApiResponse({ status: 404, description: 'This approval link is not valid' })
  async getTerms(
    @Param('id') id: string,
    @Param('token') token: string,
  ): Promise<SplitRuleTermsDto> {
    return this.splitRulesService.getProposedTerms(id, token);
  }

  @Post(':id/respond/:token')
  @Public()
  @ApiOperation({
    summary: 'Accept or reject the proposed terms (no login)',
    description:
      'ACCEPT activates the rule and closes out the previously active one in the same ' +
      'transaction, so there is never a moment with two active rules or none. REJECT ' +
      'records the refusal and the rule never activates. Either way the token is spent, ' +
      'and the decision is written to the immutable audit trail.',
  })
  @ApiResponse({ status: 201, type: SplitRuleResponseDto })
  @ApiResponse({ status: 404, description: 'This approval link is not valid' })
  @ApiResponse({ status: 409, description: 'This proposal has already been answered' })
  async respond(
    @Param('id') id: string,
    @Param('token') token: string,
    @Body() dto: RespondSplitRuleDto,
  ): Promise<SplitRuleResponseDto> {
    return toResponse(await this.splitRulesService.respond(id, token, dto.decision));
  }

  @Get('venue/:venueId')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Full split-rule history for a venue, newest first' })
  @ApiResponse({ status: 200, type: [SplitRuleResponseDto] })
  async findAllByVenue(@Param('venueId') venueId: string): Promise<SplitRuleResponseDto[]> {
    return (await this.splitRulesService.findAllByVenue(venueId)).map(toResponse);
  }

  @Get('venue/:venueId/active')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({
    summary: 'The rule currently dividing money for this venue',
    description:
      'Only ever an ACTIVE rule. A proposal awaiting entertainer consent is never ' +
      'returned here, and 404 means no agreed rule is in force — which is why payment ' +
      'initialization refuses rather than guessing a split.',
  })
  @VenueScoped()
  @ApiResponse({ status: 200, type: SplitRuleResponseDto })
  @ApiResponse({ status: 404, description: 'No active split rule found' })
  async findActiveByVenue(@Param('venueId') venueId: string): Promise<SplitRuleResponseDto> {
    return toResponse(await this.splitRulesService.findActiveByVenue(venueId));
  }

  @Get(':id/audit')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({
    summary: 'Immutable audit trail for a split rule',
    description:
      'Who proposed it, who answered, when, and by what route. Append-only, enforced by ' +
      'a database trigger.',
  })
  @ApiResponse({ status: 200, description: 'Audit events, oldest first' })
  async findAuditTrail(@Param('id') id: string) {
    return this.splitRulesService.findAuditTrail(id);
  }

  /**
   * The entertainer opens this in a browser, so it points at the frontend. Falls
   * back to the API's own origin when no frontend is configured, which at least
   * yields a link that resolves rather than one that silently does not.
   */
  private buildConsentUrl(splitRuleId: string, token: string): string {
    const base = (
      this.config.get<string>('FRONTEND_URL') ??
      this.config.get<string>('APP_URL') ??
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}/split-rules/${splitRuleId}/respond/${token}`;
  }
}

/**
 * Explicit mapping, not a spread of the entity: responseTokenHash must never
 * reach a client, and returning the row directly is how it would.
 */
function toResponse(rule: SplitRule): SplitRuleResponseDto {
  return {
    id: rule.id,
    venueId: rule.venueId,
    entertainerBps: rule.entertainerBps,
    venueBps: rule.venueBps,
    platformBps: rule.platformBps,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    status: rule.status,
    origin: rule.origin,
    entertainerId: rule.entertainerId,
    proposedByUserId: rule.proposedByUserId,
    proposedAt: rule.proposedAt,
    respondedAt: rule.respondedAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}
