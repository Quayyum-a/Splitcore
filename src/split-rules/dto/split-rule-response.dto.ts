import { ApiProperty } from '@nestjs/swagger';
import { SplitRuleOrigin, SplitRuleStatus } from '@prisma/client';

/**
 * Every field the original Phase 2 shape carried is still here, unchanged, so
 * existing callers keep working (see Section 2.4 of the governance brief). The
 * governance fields are additive.
 *
 * `responseTokenHash` is deliberately absent and must never be added: it is the
 * only thing standing between a leaked response body and someone consenting on
 * an entertainer's behalf.
 */
export class SplitRuleResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: 'uuid-string' })
  venueId!: string;

  @ApiProperty({ example: 7000 })
  entertainerBps!: number;

  @ApiProperty({ example: 2500 })
  venueBps!: number;

  @ApiProperty({
    example: 500,
    description: "The platform's cut, always computed server-side, never client input.",
  })
  platformBps!: number;

  @ApiProperty({
    example: '2026-01-15T10:30:00Z',
    nullable: true,
    description:
      'Null while a proposal is still unanswered: a rule that is not in force has no ' +
      'date from which it applied. Always set for an ACTIVE or SUPERSEDED rule.',
  })
  effectiveFrom!: Date | null;

  @ApiProperty({ example: '2026-01-20T10:30:00Z', nullable: true })
  effectiveTo!: Date | null;

  @ApiProperty({ enum: SplitRuleStatus, example: SplitRuleStatus.ACTIVE })
  status!: SplitRuleStatus;

  @ApiProperty({
    enum: SplitRuleOrigin,
    example: SplitRuleOrigin.VENUE_PROPOSAL,
    description:
      'VENUE_PROPOSAL means the entertainer accepted these terms. ADMIN_OVERRIDE means ' +
      'the platform set them directly and no entertainer agreed.',
  })
  origin!: SplitRuleOrigin;

  @ApiProperty({
    example: 'uuid-string',
    nullable: true,
    description: 'The entertainer whose consent this rule needed. Null for an ADMIN_OVERRIDE.',
  })
  entertainerId!: string | null;

  @ApiProperty({ example: 'uuid-string', nullable: true })
  proposedByUserId!: string | null;

  @ApiProperty({ example: '2026-01-15T10:30:00Z' })
  proposedAt!: Date;

  @ApiProperty({ example: '2026-01-15T11:00:00Z', nullable: true })
  respondedAt!: Date | null;

  @ApiProperty({ example: '2026-01-15T10:30:00Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-15T10:30:00Z' })
  updatedAt!: Date;
}

/**
 * Returned once, from the proposal call only. The raw consent token appears
 * here and nowhere else — only its hash is stored — so if this response is lost
 * the proposal has to be made again.
 */
export class SplitRuleProposalResponseDto extends SplitRuleResponseDto {
  @ApiProperty({
    description:
      'Give this to the entertainer. There is no notification channel yet (entertainers ' +
      'have a phone number but no email, and no notifications module exists), so the ' +
      'venue dashboard has to deliver it. Shown once and never retrievable again.',
    example: 'https://splitcore-app.netlify.app/split-rules/<id>/respond/<token>',
  })
  consentUrl!: string;

  @ApiProperty({ description: 'The raw token, if you would rather build your own URL.' })
  consentToken!: string;
}
