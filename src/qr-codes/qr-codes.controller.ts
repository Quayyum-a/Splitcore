import { Controller, Get, Post, Delete, Body, Param, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { QrCodesService } from './qr-codes.service';
import { CreateQrCodeDto } from './dto/create-qr-code.dto';
import { QrCodeResponseDto } from './dto/qr-code-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { VenueScoped } from '../common/guards/venue-scoped.guard';
import { Role } from '@prisma/client';

@ApiTags('QR Codes')
@ApiBearerAuth()
@Controller('qr-codes')
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @VenueScoped()
  @ApiOperation({ summary: 'Create a new QR code (venue-scoped for Venue Admins)' })
  @ApiResponse({
    status: 201,
    description: 'QR code created successfully',
    type: QrCodeResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed or entertainer not linked to venue' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied to this venue' })
  @ApiResponse({ status: 404, description: 'Venue or entertainer not found' })
  async create(@Body() dto: CreateQrCodeDto): Promise<QrCodeResponseDto> {
    return this.qrCodesService.create(dto);
  }

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'List all QR codes (filtered by venue access)' })
  @ApiResponse({
    status: 200,
    description: 'List of QR codes',
    type: [QrCodeResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(@Request() req: any): Promise<QrCodeResponseDto[]> {
    return this.qrCodesService.findAll(req.user.id, req.user.role);
  }

  @Get(':qrCodeId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'Get QR code details by ID' })
  @ApiResponse({
    status: 200,
    description: 'QR code details',
    type: QrCodeResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'QR code not found' })
  async findOne(@Param('qrCodeId') qrCodeId: string): Promise<QrCodeResponseDto> {
    return this.qrCodesService.findOne(qrCodeId);
  }

  @Delete(':qrCodeId')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({ summary: 'Deactivate QR code (soft delete)' })
  @ApiResponse({
    status: 200,
    description: 'QR code deactivated successfully',
    type: QrCodeResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'QR code not found' })
  async deactivate(@Param('qrCodeId') qrCodeId: string): Promise<QrCodeResponseDto> {
    return this.qrCodesService.deactivate(qrCodeId);
  }

  @Post(':qrCodeId/regenerate')
  @Roles(Role.PLATFORM_ADMIN, Role.VENUE_ADMIN)
  @ApiOperation({
    summary: 'Regenerate QR code (deactivates old, creates new with new token)',
  })
  @ApiResponse({
    status: 201,
    description: 'QR code regenerated successfully',
    type: QrCodeResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'QR code not found' })
  async regenerate(@Param('qrCodeId') qrCodeId: string): Promise<QrCodeResponseDto> {
    return this.qrCodesService.regenerate(qrCodeId);
  }
}
