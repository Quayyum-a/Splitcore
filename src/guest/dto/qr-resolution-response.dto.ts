import { ApiProperty } from '@nestjs/swagger';

class VenueBasicDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: 'Quilox Nightclub' })
  name!: string;

  @ApiProperty({ example: 'https://example.com/logo.png', nullable: true })
  logoUrl!: string | null;

  @ApiProperty({ example: 'Victoria Island, Lagos' })
  location!: string;
}

class EntertainerBasicDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: 'DJ Neptune' })
  stageName!: string;
}

export class QrResolutionResponseDto {
  @ApiProperty({ type: VenueBasicDto })
  venue!: VenueBasicDto;

  @ApiProperty({ type: EntertainerBasicDto, nullable: true })
  entertainer!: EntertainerBasicDto | null;

  @ApiProperty({ example: 'Table 5' })
  location!: string;

  @ApiProperty({ example: 'session-uuid-string' })
  sessionId!: string;

  @ApiProperty({ example: '2024-01-16T10:30:00Z' })
  expiresAt!: Date;
}
