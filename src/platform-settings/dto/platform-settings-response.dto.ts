import { ApiProperty } from '@nestjs/swagger';

export class PlatformSettingsResponseDto {
  @ApiProperty({
    description: "The platform's cut in basis points. 500 = 5%.",
    example: 500,
  })
  platformFeeBps!: number;

  @ApiProperty({
    description:
      'What a venue and entertainer have left to divide between them, in basis points. ' +
      'A proposed split rule must sum to exactly this.',
    example: 9500,
  })
  splittableBps!: number;

  @ApiProperty({ example: '2026-09-26T12:00:00Z' })
  updatedAt!: Date;
}
