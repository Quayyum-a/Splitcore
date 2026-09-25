import { IsInt, IsOptional, IsString, IsUUID, IsBoolean, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for payment initialization
 *
 * Flow: Guest scans QR → picks amount → calls this endpoint
 * Returns Paystack's hosted checkout URL (never build custom card form)
 */
export class InitializePaymentDto {
  @ApiProperty({
    description: 'Guest session ID from QR scan',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  sessionId!: string;

  @ApiProperty({
    description: 'Tip amount in kobo (₦1 = 100 kobo). Must be ≥₦100 (10000 kobo)',
    example: 500000, // ₦5,000
    minimum: 10000, // ₦100 minimum
    maximum: 1000000000, // ₦10M maximum (reasonable safety limit)
  })
  @IsInt()
  @Min(10000, { message: 'Amount must be at least ₦100 (10000 kobo)' })
  @Max(1000000000, { message: 'Amount cannot exceed ₦10,000,000' })
  amountKobo!: number;

  @ApiPropertyOptional({
    description: "Guest's display name (optional, shown to entertainer)",
    example: 'Anonymous Fan',
  })
  @IsOptional()
  @IsString()
  guestDisplayName?: string;

  @ApiPropertyOptional({
    description: 'Whether to show guest display name to entertainer',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  displayNameEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Guest email (optional, for payment receipt)',
    example: 'guest@example.com',
  })
  @IsOptional()
  @IsString()
  email?: string;
}
