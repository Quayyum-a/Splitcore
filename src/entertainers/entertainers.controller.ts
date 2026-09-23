import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { EntertainersService } from './entertainers.service';
import { CreateEntertainerDto } from './dto/create-entertainer.dto';
import { UpdateEntertainerDto } from './dto/update-entertainer.dto';
import { EntertainerResponseDto } from './dto/entertainer-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { VenueScoped } from '../common/guards/venue-scoped.guard';
import { Role } from '@prisma/client';

@ApiTags('Entertainers')
@ApiBearerAuth()
@Controller('entertainers')
export class EntertainersController {
  constructor(private readonly entertainersService: EntertainersService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'Create a new entertainer' })
  @ApiResponse({
    status: 201,
    description: 'Entertainer created successfully',
    type: EntertainerResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Conflict - duplicate phone number' })
  async create(@Body() dto: CreateEntertainerDto): Promise<EntertainerResponseDto> {
    return this.entertainersService.create(dto);
  }

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'List all entertainers (filtered by venue access)' })
  @ApiResponse({
    status: 200,
    description: 'List of entertainers',
    type: [EntertainerResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(@Request() req: any): Promise<EntertainerResponseDto[]> {
    return this.entertainersService.findAll(req.user.id, req.user.role);
  }

  @Get(':entertainerId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'Get entertainer details by ID' })
  @ApiResponse({
    status: 200,
    description: 'Entertainer details',
    type: EntertainerResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Entertainer not found' })
  async findOne(@Param('entertainerId') entertainerId: string): Promise<EntertainerResponseDto> {
    return this.entertainersService.findOne(entertainerId);
  }

  @Patch(':entertainerId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'Update entertainer' })
  @ApiResponse({
    status: 200,
    description: 'Entertainer updated successfully',
    type: EntertainerResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Entertainer not found' })
  @ApiResponse({ status: 409, description: 'Conflict - duplicate phone number' })
  async update(
    @Param('entertainerId') entertainerId: string,
    @Body() dto: UpdateEntertainerDto,
  ): Promise<EntertainerResponseDto> {
    return this.entertainersService.update(entertainerId, dto);
  }

  @Delete(':entertainerId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({
    summary: 'Deactivate entertainer (soft delete) and cascade to QR codes',
  })
  @ApiResponse({
    status: 200,
    description: 'Entertainer deactivated successfully',
    type: EntertainerResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Entertainer not found' })
  async deactivate(@Param('entertainerId') entertainerId: string): Promise<EntertainerResponseDto> {
    return this.entertainersService.deactivate(entertainerId);
  }

  @Post(':entertainerId/venues/:venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Link entertainer to venue (venue-scoped for Venue Admins)' })
  @ApiResponse({
    status: 201,
    description: 'Entertainer linked to venue successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  @ApiResponse({ status: 409, description: 'Conflict - already linked' })
  async linkToVenue(
    @Param('entertainerId') entertainerId: string,
    @Param('venueId') venueId: string,
  ): Promise<{ message: string }> {
    await this.entertainersService.linkToVenue(entertainerId, venueId);
    return { message: 'Entertainer linked to venue successfully' };
  }

  @Delete(':entertainerId/venues/:venueId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Unlink entertainer from venue (venue-scoped for Venue Admins)' })
  @ApiResponse({
    status: 200,
    description: 'Entertainer unlinked from venue successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  @ApiResponse({ status: 404, description: 'Not Found - link does not exist' })
  async unlinkFromVenue(
    @Param('entertainerId') entertainerId: string,
    @Param('venueId') venueId: string,
  ): Promise<{ message: string }> {
    await this.entertainersService.unlinkFromVenue(entertainerId, venueId);
    return { message: 'Entertainer unlinked from venue successfully' };
  }
}
