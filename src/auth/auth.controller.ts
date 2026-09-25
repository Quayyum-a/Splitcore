import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { AuthRateLimit } from '../common/throttler/auth-rate-limit.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Deliberately no /auth/register here. Platform admins and venue admins
  // are provisioned by an existing admin (Phase 2's admin module) or the
  // seed script — not self-service signup. A tipping platform moving real
  // money has no business exposing an open registration endpoint for the
  // accounts that control payout configuration.
  @Post('login')
  @Public()
  // The only route that opts into the strict 5/minute limit.
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticate with email and password to receive a JWT token',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Returns JWT access token and user details.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid credentials.' })
  @ApiResponse({ status: 400, description: 'Bad Request. Validation failed.' })
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    return this.authService.login(user);
  }
}
