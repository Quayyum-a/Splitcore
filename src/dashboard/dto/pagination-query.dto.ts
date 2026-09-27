import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Pagination for the dashboard history endpoints.
 *
 * A DTO rather than `@Query('limit', new ParseIntPipe({ optional: true }))`.
 * That form looked right and shipped broken: with the global ValidationPipe also
 * in the chain, ParseIntPipe did not honour `optional`, so omitting the
 * parameters answered `400 Validation failed (numeric string is expected)` -
 * meaning the history endpoints could not be called without explicitly passing
 * both. Unit tests invoking the controller method directly never saw it, because
 * they bypass the pipes entirely; only an end-to-end request goes through them.
 *
 * `@Type` is required because the global pipe does not enable implicit
 * conversion, and query values always arrive as strings.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page size. Default 50, maximum 200.',
    minimum: 1,
    maximum: 200,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Rows to skip. Default 0.', minimum: 0, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
