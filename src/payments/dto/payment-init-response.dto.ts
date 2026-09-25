import { ApiProperty } from '@nestjs/swagger';

/**
 * Response from payment initialization
 * Contains Paystack checkout URL to redirect guest to
 */
export class PaymentInitResponseDto {
  @ApiProperty({
    description: 'Payment transaction ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  transactionId!: string;

  @ApiProperty({
    description: "External reference (our reference, not Paystack's)",
    example: 'pay_1234567890abcdef',
  })
  reference!: string;

  @ApiProperty({
    description: 'Paystack checkout URL - redirect guest here',
    example: 'https://checkout.paystack.com/abcdef123456',
  })
  authorizationUrl!: string;

  @ApiProperty({
    description: 'Paystack access code for this payment session',
    example: 'abcdef123456',
  })
  accessCode!: string;

  @ApiProperty({
    description: 'Amount in kobo',
    example: 500000,
  })
  amountKobo!: number;

  @ApiProperty({
    description: 'Payment status',
    example: 'CREATED',
  })
  status!: string;
}
