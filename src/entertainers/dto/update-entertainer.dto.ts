import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, Matches, IsOptional, IsBoolean } from 'class-validator';

export class UpdateEntertainerDto {
  @ApiProperty({ description: 'Stage name', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  stageName?: string;

  @ApiProperty({ description: 'Legal name', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  legalName?: string;

  @ApiProperty({ description: 'Phone number', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Phone must be a valid E.164 format' })
  phone?: string;

  @ApiProperty({ description: 'Bank name', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiProperty({ description: 'Bank account number', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'Account number must contain only digits' })
  @MinLength(10)
  @MaxLength(10)
  accountNumber?: string;

  @ApiProperty({ description: 'Active status', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
