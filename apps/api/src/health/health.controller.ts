import { Controller, Get, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { HealthResponseDto } from './health.dto.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(InfrastructureService) private readonly infrastructure: InfrastructureService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness; no dependency checks' })
  @ApiOkResponse({ type: HealthResponseDto })
  live(): HealthResponseDto {
    return { status: 'ok', service: 'api' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness of PostgreSQL and Redis connections' })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthResponseDto> {
    const results = await Promise.allSettled([
      this.infrastructure.pingDatabase(),
      this.infrastructure.pingRedis(),
    ]);
    const checks = {
      database: results[0].status === 'fulfilled' ? 'up' : 'down',
      redis: results[1].status === 'fulfilled' ? 'up' : 'down',
    } as const;
    const ready = checks.database === 'up' && checks.redis === 'up';
    response.status(ready ? 200 : 503);
    return { status: ready ? 'ok' : 'error', service: 'api', checks };
  }
}
