import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Deliberately no /auth/register here. Platform admins and venue admins
  // are provisioned by an existing admin (Phase 2's admin module) or the
  // seed script — not self-service signup. A tipping platform moving real
  // money has no business exposing an open registration endpoint for the
  // accounts that control payout configuration.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    return this.authService.login(user);
  }
}
