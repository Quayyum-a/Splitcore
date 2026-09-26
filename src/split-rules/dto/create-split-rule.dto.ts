import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max } from 'class-validator';

/**
 * A venue's proposal.
 *
 * There is deliberately no `platformBps` property. The global ValidationPipe
 * runs with forbidNonWhitelisted, so a payload that carries one is rejected
 * with 400 rather than quietly ignored — the platform's cut is not something a
 * venue gets to express an opinion about.
 *
 * entertainerBps + venueBps must equal 10000 minus the current platform fee.
 * That sum cannot be checked here because it depends on stored settings, so
 * SplitRulesService checks it against the live value.
 */
export class CreateSplitRuleDto {
  @ApiProperty({ description: 'Venue the rule applies to', example: 'uuid-string' })
  @IsUUID()
  venueId!: string;

  @ApiProperty({
    description:
      'The entertainer who must accept these terms before they take effect. The rule ' +
      'stays PENDING_ENTERTAINER_APPROVAL until they do.',
    example: 'uuid-string',
  })
  @IsUUID()
  entertainerId!: string;

  @ApiProperty({ description: 'Entertainer share in basis points', example: 7000 })
  @IsInt()
  @Min(0)
  @Max(10000)
  entertainerBps!: number;

  @ApiProperty({ description: 'Venue share in basis points', example: 2500 })
  @IsInt()
  @Min(0)
  @Max(10000)
  venueBps!: number;
}
