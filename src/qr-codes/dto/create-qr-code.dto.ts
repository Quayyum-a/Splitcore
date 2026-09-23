import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CreateQrCodeDto {
  @ApiProperty({ description: 'Venue ID', example: 'uuid-string' })
  @IsUUID()
  venueId!: string;

  @ApiProperty({ description: 'Entertainer ID (optional)', required: false, example: 'uuid-string' })
  @IsOptional()
  @IsUUID()
  entertainerId?: string;

  @ApiProperty({ description: 'Physical location of QR code', example: 'Table 5' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  location!: string;
}
