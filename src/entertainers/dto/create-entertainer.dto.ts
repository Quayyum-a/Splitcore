import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';

export class CreateEntertainerDto {
  @ApiProperty({ description: 'Stage name', example: 'DJ Neptune' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  stageName!: string;

  @ApiProperty({ description: 'Legal name (for KYC)', example: 'Patrick Imohiosen' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  legalName!: string;

  @ApiProperty({ description: 'Phone number (unique, E.164 format)', example: '+2348012345678' })
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Phone must be a valid E.164 format' })
  phone!: string;

  @ApiProperty({ description: 'Bank name', required: false, example: 'GTBank' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiProperty({
    description: 'Bank account number (digits only)',
    required: false,
    example: '0123456789',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'Account number must contain only digits' })
  @MinLength(10)
  @MaxLength(10)
  accountNumber?: string;
}
