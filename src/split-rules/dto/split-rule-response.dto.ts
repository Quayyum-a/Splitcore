import { ApiProperty } from '@nestjs/swagger';

export class SplitRuleResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: 'uuid-string' })
  venueId!: string;

  @ApiProperty({ example: 7000 })
  entertainerBps!: number;

  @ApiProperty({ example: 2500 })
  venueBps!: number;

  @ApiProperty({ example: 500 })
  platformBps!: number;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  effectiveFrom!: Date;

  @ApiProperty({ example: '2024-01-20T10:30:00Z', nullable: true })
  effectiveTo!: Date | null;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  updatedAt!: Date;
}
