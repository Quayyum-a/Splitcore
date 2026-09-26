import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';

export class UpdatePlatformSettingsDto {
  @ApiProperty({
    description:
      "The platform's cut in basis points (0-10000). 500 = 5%. Applies to split " +
      'rules proposed from now on; rules already in force keep the fee they were agreed under.',
    example: 500,
  })
  @IsInt()
  @Min(0)
  // Not 10000: the platform taking everything would leave nothing to split,
  // and every split proposal would then have to sum to zero.
  @Max(9000)
  platformFeeBps!: number;
}
