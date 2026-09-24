import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, Matches, IsOptional, IsUrl } from 'class-validator';

export class CreateVenueDto {
  @ApiProperty({ description: 'Venue name', example: 'Quilox Nightclub' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description: 'URL-friendly slug (lowercase letters, numbers, hyphens only)',
    example: 'quilox-nightclub',
  })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  @MinLength(1)
  @MaxLength(50)
  slug!: string;

  @ApiProperty({
    description: 'URL to venue logo image',
    example: 'https://example.com/logo.png',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiProperty({ description: 'Venue location/address', example: 'Victoria Island, Lagos' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  location!: string;
}
