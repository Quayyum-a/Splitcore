import { Controller, Get, Patch, Body, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingsResponseDto } from './dto/platform-settings-response.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * The platform fee.
 *
 * Readable by venue admins so a venue dashboard can show the fee it is charged;
 * writable only by PLATFORM_ADMIN. Note there is deliberately no venue-scoped
 * route here at all — the fee is not a per-venue resource, so there is no path
 * a venue-scoped caller could take to change it.
 */
@ApiTags('Platform Settings')
@ApiBearerAuth()
@Controller('platform/settings')
export class PlatformSettingsController {
  constructor(private readonly platformSettings: PlatformSettingsService) {}

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({
    summary: 'Read the platform fee (any authenticated role)',
    description:
      'Venue admins need this to show what they are charged and to build a split ' +
      'proposal, which must sum to splittableBps.',
  })
  @ApiResponse({ status: 200, type: PlatformSettingsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async get(): Promise<PlatformSettingsResponseDto> {
    const settings = await this.platformSettings.get();
    return toResponse(settings.platformFeeBps, settings.updatedAt);
  }

  @Patch()
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({
    summary: 'Change the platform fee (PLATFORM_ADMIN only)',
    description:
      'Split rules already in force are not rewritten: each keeps the platformBps ' +
      'it was agreed under. The new fee applies to rules proposed from now on.',
  })
  @ApiResponse({ status: 200, type: PlatformSettingsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - PLATFORM_ADMIN only' })
  async update(
    @Body() dto: UpdatePlatformSettingsDto,
    @Request() req: { user: { id: string } },
  ): Promise<PlatformSettingsResponseDto> {
    const settings = await this.platformSettings.update(dto.platformFeeBps, req.user.id);
    return toResponse(settings.platformFeeBps, settings.updatedAt);
  }
}

function toResponse(platformFeeBps: number, updatedAt: Date): PlatformSettingsResponseDto {
  return {
    platformFeeBps,
    splittableBps: 10000 - platformFeeBps,
    updatedAt,
  };
}
