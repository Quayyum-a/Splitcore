import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

/**
 * Bank details.
 *
 * `bankCode` used to be required and validated only as "3-6 digits", with nothing
 * to check it against - so a transposed digit named a real but different bank,
 * and the mistake surfaced as a transfer to a stranger. Both fields are now
 * optional-but-one-required, and whichever arrives is resolved against the
 * provider's live list (GET /banks); an unrecognised or ambiguous input is a 400.
 *
 * `bankCode` is the better input - unambiguous, and exactly what GET /banks
 * returns - and is kept for that reason, not for backwards compatibility.
 * `bankName` exists so a caller can accept a typed name and still be told
 * clearly when it is ambiguous.
 */
export class SubmitBankDetailsDto {
  @ApiPropertyOptional({
    description:
      'Bank name, resolved against GET /banks. Rejected if it matches nothing, or if it matches ' +
      'more than one bank - "First Bank" and "First Bank MFB" are different destinations, so it ' +
      'asks rather than choosing. Either this or bankCode is required.',
    example: 'GTBank',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  bankName?: string;

  @ApiPropertyOptional({
    description:
      'Provider bank code from GET /banks. Preferred over bankName. Validated against the live ' +
      'list, so a typo is rejected rather than silently naming another bank.',
    example: '058',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'bankCode must be a 3-6 digit provider bank code' })
  bankCode?: string;

  @ApiProperty({ description: 'NUBAN account number (10 digits)', example: '0123456789' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'accountNumber must be exactly 10 digits' })
  accountNumber!: string;
}

export class ConfirmAccountDto {
  @ApiProperty({
    description:
      'The account holder name the entertainer is confirming. Must match what the bank returned, ' +
      'so a stale screen cannot confirm a name that has since changed.',
    example: 'PATRICK IMOHIOSEN',
  })
  @IsString()
  @MinLength(2)
  confirmedAccountName!: string;
}

export class VerifyIdentityDto {
  @ApiProperty({ enum: ['BVN', 'NIN'], example: 'BVN' })
  @IsIn(['BVN', 'NIN'])
  documentType!: 'BVN' | 'NIN';

  @ApiProperty({
    description:
      'The identity number. Passed to the provider and NEVER stored, logged or returned - only ' +
      'the document type and the outcome are retained.',
    example: '22222222222',
  })
  @IsString()
  @Matches(/^\d{11}$/, { message: 'documentNumber must be exactly 11 digits (BVN or NIN)' })
  documentNumber!: string;
}

export class DecideKycReviewDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'], example: 'APPROVE' })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiProperty({
    description: 'Why. Recorded against the entertainer.',
    example: 'Passport and bank statement checked manually, ticket SC-2001.',
  })
  @IsString()
  @MinLength(10)
  reason!: string;
}

export class KycStatusResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  entertainerId!: string;

  @ApiProperty({ enum: KycStatus, example: KycStatus.PENDING })
  status!: KycStatus;

  @ApiProperty({
    enum: ['BANK_DETAILS', 'RESOLVE_ACCOUNT', 'CONFIRM_ACCOUNT', 'VERIFY_IDENTITY', 'DONE'],
    description: 'The next step in the onboarding flow. Derived, not stored.',
    example: 'CONFIRM_ACCOUNT',
  })
  nextStep!: string;

  @ApiProperty({ example: 'GTBank', nullable: true })
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
    example: 'PATRICK IMOHIOSEN',
    nullable: true,
    description: "The account holder's name as the bank reports it.",
  })
  resolvedAccountName!: string | null;

  @ApiProperty({ nullable: true })
  accountConfirmedAt!: Date | null;

  @ApiProperty({
    example: 'BVN',
    nullable: true,
    description: 'Document type only, never the number.',
  })
  identityCheckType!: string | null;

  @ApiProperty({ nullable: true })
  identityCheckedAt!: Date | null;

  @ApiProperty({ nullable: true, example: 'Identity verification is not enabled on this account.' })
  failureReason!: string | null;

  @ApiProperty({
    example: false,
    description: 'Whether a payout will actually be attempted for this entertainer.',
  })
  payoutsEnabled!: boolean;
}
