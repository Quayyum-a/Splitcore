import { ApiProperty } from '@nestjs/swagger';

export class VenueResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  id!: string;

  @ApiProperty({ example: 'Quilox Nightclub' })
  name!: string;

  @ApiProperty({ example: 'quilox-nightclub' })
  slug!: string;

  @ApiProperty({ example: 'https://example.com/logo.png', nullable: true })
  logoUrl!: string | null;

  @ApiProperty({ example: 'Victoria Island, Lagos' })
  location!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  updatedAt!: Date;
}
