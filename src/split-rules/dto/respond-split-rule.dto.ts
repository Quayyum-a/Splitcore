import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class RespondSplitRuleDto {
  @ApiProperty({
    description: "The entertainer's answer to the proposed terms.",
    enum: ['ACCEPT', 'REJECT'],
    example: 'ACCEPT',
  })
  @IsIn(['ACCEPT', 'REJECT'])
  decision!: 'ACCEPT' | 'REJECT';
}

/** What the entertainer is shown before deciding. Plain percentages, no jargon. */
export class SplitRuleTermsDto {
  @ApiProperty({ example: 'Quilox Nightclub' })
  venueName!: string;

  @ApiProperty({ example: 'DJ Neptune' })
  entertainerName!: string;

  @ApiProperty({ example: 70, description: 'Your share, as a percentage.' })
  entertainerPercentage!: number;

  @ApiProperty({ example: 25, description: "The venue's share, as a percentage." })
  venuePercentage!: number;

  @ApiProperty({ example: 5, description: "Splitcore's fee, as a percentage. Fixed." })
  platformPercentage!: number;

  @ApiProperty({ example: 7000 })
  entertainerBps!: number;

  @ApiProperty({ example: 2500 })
  venueBps!: number;

  @ApiProperty({ example: 500 })
  platformBps!: number;

  @ApiProperty({ example: '2026-09-26T12:00:00Z' })
  proposedAt!: Date;

  @ApiProperty({
    example: 'On a 5,000 naira tip you would receive 3,500 naira.',
    description: 'A worked example, so the percentages mean something concrete.',
  })
  example!: string;
}
