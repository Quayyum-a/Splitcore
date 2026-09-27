import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { BanksService } from './banks.service';
import { BankResponseDto } from './dto/bank-response.dto';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * Reference data, but authenticated.
 *
 * It is not secret - Paystack's bank list is public - so the reason is not
 * confidentiality. It is that an unauthenticated endpoint which proxies a third
 * party is a free egress and cache-fill vector pointed at someone else's API,
 * and nothing needs it before login: every caller that picks a bank (an
 * entertainer onboarding, a venue admin bootstrapping one, a venue admin setting
 * up their own payout account) already holds a session. Any role may read it.
 */
@ApiTags('Banks')
@ApiBearerAuth()
@Controller('banks')
export class BanksController {
  constructor(private readonly banks: BanksService) {}

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN, Role.ENTERTAINER)
  @ApiOperation({
    summary: 'Banks that can receive a payout',
    description:
      "The provider's own list, cached for 24 hours, filtered to banks that are active and " +
      'support transfers - offering one that cannot receive a transfer only moves the failure later. ' +
      'Sorted by name. Use the returned code when submitting bank details.',
  })
  @ApiResponse({ status: 200, type: [BankResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(): Promise<BankResponseDto[]> {
    return this.banks.list();
  }
}
