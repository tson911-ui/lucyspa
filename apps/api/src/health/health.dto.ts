import type { HealthResponse } from '@lucy-spa/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DependencyChecksDto {
  @ApiProperty({ type: String, enum: ['up', 'down'] })
  database!: 'up' | 'down';

  @ApiProperty({ type: String, enum: ['up', 'down'] })
  redis!: 'up' | 'down';
}

export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ type: String, enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ type: String, example: 'api' })
  service!: string;

  @ApiPropertyOptional({ type: DependencyChecksDto })
  checks?: DependencyChecksDto;
}
