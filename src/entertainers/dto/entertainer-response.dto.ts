import { ApiProperty } from '@nestjs/swagger';

export class EntertainerResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: 'DJ Neptune' })
  stageName!: string;

  @ApiProperty({ example: 'Patrick Imohiosen' })
  legalName!: string;

  @ApiProperty({ example: '+2348012345678' })
  phone!: string;

  @ApiProperty({ example: 'GTBank', nullable: true })
  bankName!: string | null;

  @ApiProperty({ example: '0123456789', nullable: true })
  accountNumber!: string | null;

  @ApiProperty({
    enum: ['NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED', 'REVIEW', 'SUSPENDED'],
  })
  kycStatus!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  updatedAt!: Date;

  @ApiProperty({
    description: 'List of venue IDs this entertainer is linked to',
    type: [String],
  })
  venueIds!: string[];
}
