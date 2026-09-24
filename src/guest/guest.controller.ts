import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { GuestService } from './guest.service';
import { QrResolutionResponseDto } from './dto/qr-resolution-response.dto';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Guest')
@Controller()
export class GuestController {
  constructor(private readonly guestService: GuestService) {}

  @Get('/t/:publicToken')
  @Public()
  @ApiOperation({ summary: 'Resolve QR code and create guest session (public, no auth required)' })
  @ApiResponse({
    status: 200,
    description: 'QR code resolved successfully, session created',
    type: QrResolutionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'QR code not found (token does not exist)' })
  @ApiResponse({ status: 410, description: 'Gone - QR code, venue, or entertainer is deactivated' })
  async resolveQrCode(@Param('publicToken') publicToken: string): Promise<QrResolutionResponseDto> {
    return this.guestService.resolveQrCode(publicToken);
  }
}
