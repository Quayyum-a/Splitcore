import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { VenuesService } from './venues.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { VenueResponseDto } from './dto/venue-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { VenueScoped } from '../common/guards/venue-scoped.guard';
import { Role } from '@prisma/client';

@ApiTags('Venues')
@ApiBearerAuth()
@Controller('venues')
export class VenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Create a new venue (Platform Admin only)' })
  @ApiResponse({ status: 201, description: 'Venue created successfully', type: VenueResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  @ApiResponse({ status: 409, description: 'Conflict - duplicate slug' })
  async create(@Body() dto: CreateVenueDto): Promise<VenueResponseDto> {
    return this.venuesService.create(dto);
  }

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'List all venues (filtered by user role)' })
  @ApiResponse({ status: 200, description: 'List of venues', type: [VenueResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(@Request() req: any): Promise<VenueResponseDto[]> {
    return this.venuesService.findAll(req.user.id, req.user.role);
  }

  @Get(':venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'Get venue details by ID' })
  @ApiResponse({ status: 200, description: 'Venue details', type: VenueResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Venue not found' })
  async findOne(@Param('venueId') venueId: string): Promise<VenueResponseDto> {
    return this.venuesService.findOne(venueId);
  }

  @Patch(':venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Update venue (venue-scoped for Venue Admins)' })
  @ApiResponse({ status: 200, description: 'Venue updated successfully', type: VenueResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  @ApiResponse({ status: 404, description: 'Venue not found' })
  async update(
    @Param('venueId') venueId: string,
    @Body() dto: UpdateVenueDto,
  ): Promise<VenueResponseDto> {
    return this.venuesService.update(venueId, dto);
  }

  @Delete(':venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Deactivate venue (soft delete, venue-scoped for Venue Admins)' })
  @ApiResponse({
    status: 200,
    description: 'Venue deactivated successfully',
    type: VenueResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  @ApiResponse({ status: 404, description: 'Venue not found' })
  async deactivate(@Param('venueId') venueId: string): Promise<VenueResponseDto> {
    return this.venuesService.deactivate(venueId);
  }
}
