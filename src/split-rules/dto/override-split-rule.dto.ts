import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max, IsString, MinLength, Validate } from 'class-validator';
import { SplitRuleSumValidator } from '../validators/split-rule-sum.validator';

/**
 * PLATFORM_ADMIN force-set. The exception, not the normal flow.
 *
 * Its own endpoint rather than a flag on the proposal DTO, for two reasons: a
 * venue payload containing platformBps must still be a 400, and an override has
 * to be obvious in the request log, not a variant of an ordinary create.
 * Rules made this way are stamped ADMIN_OVERRIDE so nothing downstream can
 * mistake them for terms an entertainer agreed to.
 */
export class OverrideSplitRuleDto {
  @ApiProperty({ example: 'uuid-string' })
  @IsUUID()
  venueId!: string;

  @ApiProperty({ example: 7000 })
  @IsInt()
  @Min(0)
  @Max(10000)
  entertainerBps!: number;

  @ApiProperty({ example: 2500 })
  @IsInt()
  @Min(0)
  @Max(10000)
  venueBps!: number;

  @ApiProperty({
    description: "The platform's cut. Accepted here, and only here.",
    example: 500,
  })
  @IsInt()
  @Min(0)
  @Max(10000)
  platformBps!: number;

  @ApiProperty({
    description: 'Why this bypassed entertainer consent. Recorded in the audit trail.',
    example: 'Dispute resolution ticket SC-1042; agreed by phone with both parties.',
  })
  @IsString()
  @MinLength(10)
  reason!: string;

  // All three shares must still total 10000.
  @Validate(SplitRuleSumValidator)
  _splitSum?: void;
}
