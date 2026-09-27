import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { SubmitBankDetailsDto } from '../../kyc/dto/kyc.dto';

/**
 * Identical to the entertainer's, deliberately: same validation, same bank
 * resolution, same "either a name or a code" rule. Subclassed rather than copied
 * so the two cannot drift apart.
 */
export class SubmitVenueBankDetailsDto extends SubmitBankDetailsDto {}

export class ConfirmVenueAccountDto {
  @ApiProperty({
    description:
      'The account holder name being confirmed. Must match what the bank returned, so a stale ' +
      'screen cannot confirm a name that has since changed.',
    example: 'QUILOX ENTERTAINMENT LIMITED',
  })
  @IsString()
  @MinLength(2)
  confirmedAccountName!: string;
}

export class VenuePayoutAccountResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  venueId!: string;

  @ApiProperty({ example: 'Quilox Nightclub' })
  venueName!: string;

  @ApiProperty({
    enum: ['BANK_DETAILS', 'RESOLVE_ACCOUNT', 'CONFIRM_ACCOUNT', 'DONE'],
    description: 'The next step. Derived, not stored.',
    example: 'CONFIRM_ACCOUNT',
  })
  nextStep!: string;

  @ApiProperty({ example: 'Guaranty Trust Bank', nullable: true })
  bankName!: string | null;

  @ApiProperty({ example: '058', nullable: true })
  bankCode!: string | null;

  @ApiProperty({
    example: '******6789',
    nullable: true,
    description: 'Last four digits only. The full number is never returned.',
  })
  accountNumberMasked!: string | null;

  @ApiProperty({
    example: 'QUILOX ENTERTAINMENT LIMITED',
    nullable: true,
    description: "The account holder's name as the bank reports it.",
  })
  resolvedAccountName!: string | null;

  @ApiProperty({ nullable: true })
  accountResolvedAt!: Date | null;

  @ApiProperty({ nullable: true })
  accountConfirmedAt!: Date | null;

  @ApiProperty({
    example: false,
    description: "Whether the venue's own VENUE_PAYABLE payouts will be attempted.",
  })
  payoutsEnabled!: boolean;
}
