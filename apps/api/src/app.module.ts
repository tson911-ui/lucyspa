import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import { HealthController } from './health/health.controller.js';
import { InfrastructureService } from './platform/infrastructure.service.js';
import { API_ENVIRONMENT, API_LOGGER, type ApiEnvironment } from './platform/tokens.js';

@Module({})
export class AppModule {
  static forRoot(environment: ApiEnvironment, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: API_LOGGER, useValue: logger },
        InfrastructureService,
      ],
    };
  }
}
