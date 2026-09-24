import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { SplitRulesService } from './split-rules.service';
import { CreateSplitRuleDto } from './dto/create-split-rule.dto';
import { SplitRuleResponseDto } from './dto/split-rule-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { VenueScoped } from '../common/guards/venue-scoped.guard';
import { Role } from '@prisma/client';

@ApiTags('Split Rules')
@ApiBearerAuth()
@Controller('split-rules')
export class SplitRulesController {
  constructor(private readonly splitRulesService: SplitRulesService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Create new split rule (closes out current active rule, venue-scoped)' })
  @ApiResponse({
    status: 201,
    description: 'Split rule created successfully',
    type: SplitRuleResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed - sum must equal 10000' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  async create(@Body() dto: CreateSplitRuleDto): Promise<SplitRuleResponseDto> {
    return this.splitRulesService.create(dto);
  }

  @Get('venue/:venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Get all split rules for venue (history, venue-scoped)' })
  @ApiResponse({
    status: 200,
    description: 'List of split rules in descending order',
    type: [SplitRuleResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  async findAllByVenue(@Param('venueId') venueId: string): Promise<SplitRuleResponseDto[]> {
    return this.splitRulesService.findAllByVenue(venueId);
  }

  @Get('venue/:venueId/active')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Get currently active split rule for venue (venue-scoped)' })
  @ApiResponse({
    status: 200,
    description: 'Active split rule',
    type: SplitRuleResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  @ApiResponse({ status: 404, description: 'No active split rule found' })
  async findActiveByVenue(@Param('venueId') venueId: string): Promise<SplitRuleResponseDto> {
    return this.splitRulesService.findActiveByVenue(venueId);
  }
}
