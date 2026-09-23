import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, IsUrl, IsBoolean } from 'class-validator';

export class UpdateVenueDto {
  @ApiProperty({ description: 'Venue name', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: 'URL to venue logo image', required: false })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiProperty({ description: 'Venue location/address', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  location?: string;

  @ApiProperty({ description: 'Active status', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
