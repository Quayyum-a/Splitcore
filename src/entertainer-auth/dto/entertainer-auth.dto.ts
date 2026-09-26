import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RedeemLoginLinkDto {
  @ApiProperty({
    description: 'The one-time token from the login link. Single use.',
    example: 'a1b2c3...',
  })
  @IsString()
  @MinLength(32)
  token!: string;
}

export class IssuedLoginLinkResponseDto {
  @ApiProperty({
    description:
      'Give this to the entertainer. There is no notification channel yet (entertainers have a ' +
      'phone number but no email, and no notifications module exists), so delivery is manual. ' +
      'Shown once - only a hash is stored.',
    example: 'https://splitcore-app.netlify.app/entertainer/login/<token>',
  })
  loginUrl!: string;

  @ApiProperty({ description: 'The raw token, if you would rather build your own URL.' })
  token!: string;

  @ApiProperty({ example: '2026-09-26T16:30:00Z' })
  expiresAt!: Date;
}

export class EntertainerSessionResponseDto {
  @ApiProperty({ description: 'Short-lived JWT scoped to the ENTERTAINER role, read-only.' })
  accessToken!: string;

  @ApiProperty({ example: 'uuid-string' })
  entertainerId!: string;

  @ApiProperty({ example: 'DJ Neptune' })
  stageName!: string;
}
