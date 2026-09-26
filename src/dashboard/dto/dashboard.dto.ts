import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus, PayoutStatus } from '@prisma/client';

/**
 * Every amount is integer kobo. No figure in this file is ever a float: the
 * aggregates sum integers in the database and formatting happens at the edge.
 */
export class VenueOverviewResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  venueId!: string;

  @ApiProperty({ example: 'Quilox Nightclub' })
  venueName!: string;

  @ApiProperty({
    example: '2026-09-26T23:00:00.000Z',
    description: 'Start of the window: midnight Africa/Lagos of the current day.',
  })
  windowFrom!: Date;

  @ApiProperty({ example: '2026-09-27T09:15:00.000Z' })
  windowTo!: Date;

  @ApiProperty({ example: 53750000, description: "Tonight's successful tips, in kobo." })
  totalTipsKobo!: number;

  @ApiProperty({ example: 183, description: 'Successful transactions tonight.' })
  transactionCount!: number;

  @ApiProperty({ example: 7, description: 'Entertainers currently linked to this venue.' })
  entertainerCount!: number;

  @ApiProperty({
    example: 2100000,
    description:
      'Obligations owed but not yet paid out, in kobo - QUEUED, RETRYING or PROCESSING. This is a ' +
      'balance as it stands now, not a figure for the window.',
  })
  pendingPayoutsKobo!: number;
}

export class EntertainerEarningsRowDto {
  @ApiProperty({ example: 'uuid-string' })
  entertainerId!: string;

  @ApiProperty({ example: 'DJ Neptune' })
  stageName!: string;

  @ApiProperty({ example: 18400000 })
  tonightKobo!: number;

  @ApiProperty({ example: 42150000 })
  thisWeekKobo!: number;

  @ApiProperty({ example: 214000000 })
  totalKobo!: number;
}

export class EntertainerOverviewResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  entertainerId!: string;

  @ApiProperty({ example: 'DJ Neptune' })
  stageName!: string;

  @ApiProperty({ example: 18400000, description: "The entertainer's own share tonight, in kobo." })
  tonightKobo!: number;

  @ApiProperty({ example: 42150000 })
  thisWeekKobo!: number;

  @ApiProperty({ example: 214000000 })
  totalKobo!: number;

  @ApiProperty({
    example: 4750000,
    description: 'Owed but not yet paid out, in kobo (QUEUED, RETRYING or PROCESSING).',
  })
  pendingPayoutsKobo!: number;

  @ApiProperty({
    example: 209250000,
    description: 'Already transferred successfully, in kobo.',
  })
  paidOutKobo!: number;
}

export class TransactionRowDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: '2026-09-26T22:14:03.000Z' })
  time!: Date;

  @ApiProperty({ example: 500000, description: 'Gross tip, in kobo.' })
  amountKobo!: number;

  @ApiProperty({ example: 'DJ Neptune', nullable: true, description: 'Null for a venue-wide QR.' })
  entertainerName!: string | null;

  @ApiProperty({
    example: 'Anonymous',
    description: "The guest's display name, or 'Anonymous' when they chose not to be named.",
  })
  guest!: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.SUCCESS })
  status!: PaymentStatus;

  @ApiProperty({ example: 'pay_kZ7JapAS1ifqJgU0oH_xt' })
  reference!: string;
}

export class PayoutRowDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: 'DJ Neptune', nullable: true })
  entertainerName!: string | null;

  @ApiProperty({ example: 425000, description: 'In kobo.' })
  amountKobo!: number;

  @ApiProperty({ enum: PayoutStatus, example: PayoutStatus.SUCCESS })
  status!: PayoutStatus;

  @ApiProperty({ example: 'po_abc_1', nullable: true })
  reference!: string | null;

  @ApiProperty({ example: '2026-09-26T22:15:11.000Z' })
  time!: Date;

  @ApiProperty({
    nullable: true,
    example: 'Action required: the provider will not complete this transfer without a human.',
  })
  failureReason!: string | null;
}

export class PaginatedDto<T> {
  @ApiProperty({ example: 183 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;

  items!: T[];
}
