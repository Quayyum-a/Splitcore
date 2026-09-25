import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { InitializePaymentDto, PaymentInitResponseDto, PaymentStatusResponseDto } from './dto';
import { Public } from '../common/decorators/public.decorator';

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
}
