import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max, Validate } from 'class-validator';
import { SplitRuleSumValidator } from '../validators/split-rule-sum.validator';

export class CreateSplitRuleDto {
  @ApiProperty({ description: 'Venue ID', example: 'uuid-string' })
  @IsUUID()
  venueId!: string;

  @ApiProperty({ description: 'Entertainer share in basis points (0-10000)', example: 7000 })
  @IsInt()
  @Min(0)
  @Max(10000)
  entertainerBps!: number;

  @ApiProperty({ description: 'Venue share in basis points (0-10000)', example: 2500 })
  @IsInt()
  @Min(0)
  @Max(10000)
  venueBps!: number;

  @ApiProperty({ description: 'Platform share in basis points (0-10000)', example: 500 })
  @IsInt()
  @Min(0)
  @Max(10000)
  platformBps!: number;

  // Phantom property to trigger sum validation
  @Validate(SplitRuleSumValidator)
  _splitSum?: void;
}
