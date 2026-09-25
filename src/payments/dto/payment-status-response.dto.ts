import { ApiProperty } from '@nestjs/swagger';

/**
 * Response from payment status check
 * Used for fallback verification when webhook hasn't fired yet
 */
export class PaymentStatusResponseDto {
  @ApiProperty({
    description: 'Payment transaction ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  transactionId!: string;

  @ApiProperty({
    description: 'External reference',
    example: 'pay_1234567890abcdef',
  })
  reference!: string;

  @ApiProperty({
    description: 'Current payment status',
    example: 'SUCCESS',
    enum: ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REVERSED', 'REFUNDED'],
  })
  status!: string;

  @ApiProperty({
    description: 'Amount in kobo',
    example: 500000,
  })
  amountKobo!: number;

  @ApiProperty({
    description: 'Venue name',
    example: 'Club Quilox',
  })
  venueName!: string;

  @ApiProperty({
    description: 'Entertainer stage name (if tip was for specific entertainer)',
    example: 'DJ Neptune',
    nullable: true,
  })
  entertainerName!: string | null;

  @ApiProperty({
    description: 'When payment was created',
    example: '2026-09-25T10:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'When payment was last updated',
    example: '2026-09-25T10:05:00.000Z',
  })
  updatedAt!: Date;
}
