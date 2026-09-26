import { ApiProperty } from '@nestjs/swagger';
import { KycStatus } from '@prisma/client';
import { IsIn, IsString, Matches, MinLength } from 'class-validator';

export class SubmitBankDetailsDto {
  @ApiProperty({ description: 'Bank name as shown to the entertainer', example: 'GTBank' })
  @IsString()
  @MinLength(2)
  bankName!: string;

  @ApiProperty({
    description:
      "Provider bank code. Fetched from the provider's bank list, not guessed from the name.",
    example: '058',
  })
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'bankCode must be a 3-6 digit provider bank code' })
  bankCode!: string;

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
