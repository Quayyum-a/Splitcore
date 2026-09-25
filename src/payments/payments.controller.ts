import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiExcludeEndpoint } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { InitializePaymentDto, PaymentInitResponseDto, PaymentStatusResponseDto } from './dto';
import { Public } from '../common/decorators/public.decorator';
import { renderCallbackPage } from './payment-callback.view';

/**
 * Payments Controller
 *
 * Public endpoints for guest payment flow:
 * - Initialize payment (get Paystack checkout URL)
 * - Check payment status (fallback verification)
 *
 * Both endpoints are @Public() - no authentication required for guests
 */
@ApiTags('payments')
// Only the 'default' limit (100/min per IP) applies here: the strict 'auth'
// limit is opt-in via @AuthRateLimit(). That matters because guests at one
// venue share an IP and poll status while waiting for their payment.
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initialize')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initialize a payment',
    description:
      'Creates a payment transaction and returns Paystack checkout URL. ' +
      "Guest will be redirected to Paystack's hosted page to complete payment. " +
      'CRITICAL: Requires active split rule for venue - will reject payment if missing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment initialized successfully',
    type: PaymentInitResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or venue has no active split rule',
  })
  @ApiResponse({
    status: 404,
    description: 'Guest session not found',
  })
  @ApiResponse({
    status: 410,
    description: 'Guest session expired or QR code/venue/entertainer deactivated',
  })
  async initializePayment(@Body() dto: InitializePaymentDto): Promise<PaymentInitResponseDto> {
    return this.paymentsService.initializePayment(dto);
  }

  @Get(':reference/status')
  @Public()
  @ApiOperation({
    summary: 'Get payment status',
    description:
      'Checks current payment status. ' +
      'For CREATED/PENDING payments, explicitly verifies with Paystack API. ' +
      "This is the fallback when webhook hasn't fired yet. " +
      'DO NOT trust client-side redirect alone as proof of payment.',
  })
  @ApiParam({
    name: 'reference',
    description: 'Payment reference (externalReference)',
    example: 'pay_1234567890abcdef',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment status retrieved',
    type: PaymentStatusResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
  })
  async getPaymentStatus(@Param('reference') reference: string): Promise<PaymentStatusResponseDto> {
    return this.paymentsService.getPaymentStatus(reference);
  }

  /**
   * Where Paystack returns the guest after checkout.
   *
   * A stand-in for the real guest frontend, so the flow can be exercised end
   * to end before that frontend exists. It does not trust the redirect: it
   * runs the same server-side verification as the status endpoint and
   * renders whatever that says.
   *
   * Paystack appends both `reference` and `trxref`, and the configured
   * callback URL already carries a `reference`, so the same key can arrive
   * twice — hence the array handling.
   */
  @Get('callback')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiExcludeEndpoint()
  async paymentCallback(
    @Query('reference') reference?: string | string[],
    @Query('trxref') trxref?: string | string[],
  ): Promise<string> {
    const resolved = first(reference) ?? first(trxref);

    if (!resolved) {
      return renderCallbackPage({
        status: 'UNKNOWN',
        detail: 'No payment reference was supplied in the callback URL.',
      });
    }

    try {
      const payment = await this.paymentsService.getPaymentStatus(resolved);
      return renderCallbackPage({
        status: payment.status,
        reference: payment.reference,
        amountKobo: payment.amountKobo,
        venueName: payment.venueName,
        entertainerName: payment.entertainerName,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        return renderCallbackPage({ status: 'UNKNOWN', reference: resolved });
      }
      throw error;
    }
  }
}

/** Express gives a repeated query parameter as an array. */
function first(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && candidate.trim() ? candidate.trim() : undefined;
}
