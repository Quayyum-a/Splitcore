import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { EntertainerAuthService } from './entertainer-auth.service';
import {
  EntertainerSessionResponseDto,
  IssuedLoginLinkResponseDto,
  RedeemLoginLinkDto,
} from './dto/entertainer-auth.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { EntertainerScoped } from '../common/guards/entertainer-scoped.guard';
import { AuthRateLimit } from '../common/throttler/auth-rate-limit.decorator';

@ApiTags('Entertainer Auth')
@Controller('entertainer-auth')
export class EntertainerAuthController {
  constructor(private readonly entertainerAuth: EntertainerAuthService) {}

  @Post('login-links/:entertainerId')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @EntertainerScoped()
  @ApiOperation({
    summary: 'Issue a one-time login link for an entertainer',
    description:
      'A venue admin may only do this for entertainers who perform at their own venue. The link ' +
      'expires in 30 minutes and is single use. Issuing a new one invalidates any outstanding link.',
  })
  @ApiParam({ name: 'entertainerId' })
  @ApiResponse({ status: 201, type: IssuedLoginLinkResponseDto })
  @ApiResponse({ status: 403, description: 'This entertainer does not perform at your venue' })
  async issue(@Param('entertainerId') entertainerId: string): Promise<IssuedLoginLinkResponseDto> {
    return this.entertainerAuth.issueLoginLink(entertainerId);
  }

  // Public by necessity: the whole point is that the entertainer has no
  // credentials yet. The token is the authorization.
  @Post('sessions')
  @Public()
  @AuthRateLimit()
  @ApiOperation({
    summary: 'Exchange a login link for a short-lived read-only session',
    description:
      'Single use: the token is burned on redemption. Expired, already-used and unknown tokens all ' +
      'answer with the same 401, so this cannot be used to probe which links are real. The JWT is ' +
      'scoped to the ENTERTAINER role and lasts 12 hours.',
  })
  @ApiResponse({ status: 201, type: EntertainerSessionResponseDto })
  @ApiResponse({ status: 401, description: 'This login link is not valid or has expired' })
  async redeem(@Body() dto: RedeemLoginLinkDto): Promise<EntertainerSessionResponseDto> {
    return this.entertainerAuth.redeem(dto.token);
  }
}
