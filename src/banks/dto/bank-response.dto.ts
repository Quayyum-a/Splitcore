import { ApiProperty } from '@nestjs/swagger';

export class BankResponseDto {
  @ApiProperty({ example: 'Guaranty Trust Bank' })
  name!: string;

  @ApiProperty({
    example: '058',
    description:
      'The provider bank code. Send this to the KYC and payout-account endpoints rather than a ' +
      'bank name - it is unambiguous, and it is validated against this list so a typo is rejected.',
  })
  code!: string;
}
