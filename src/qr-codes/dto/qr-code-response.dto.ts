import { ApiProperty } from '@nestjs/swagger';
import { VenueResponseDto } from '../../venues/dto/venue-response.dto';
import { EntertainerResponseDto } from '../../entertainers/dto/entertainer-response.dto';

export class QrCodeResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: '0123456789abcdef0123456789abcdef' })
  publicToken!: string;

  @ApiProperty({ example: 'uuid-string' })
  venueId!: string;

  @ApiProperty({ example: 'uuid-string', nullable: true })
  entertainerId!: string | null;

  @ApiProperty({ example: 'Table 5' })
  location!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2024-01-20T10:30:00Z', nullable: true })
  deactivatedAt!: Date | null;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  updatedAt!: Date;

  @ApiProperty({ type: () => VenueResponseDto, required: false })
  venue?: VenueResponseDto;

  @ApiProperty({ type: () => EntertainerResponseDto, nullable: true, required: false })
  entertainer?: EntertainerResponseDto | null;
}
