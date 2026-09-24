import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_GUARD } from '@nestjs/core';
import { AuthContextController } from './auth/auth-context.controller.js';
import { ContextThrottleService } from './auth/context-throttle.service.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { PasswordService } from './auth/password.service.js';
import { SessionService } from './auth/session.service.js';
import { HealthController } from './health/health.controller.js';
import { InfrastructureService } from './platform/infrastructure.service.js';
import { API_ENVIRONMENT, API_LOGGER, type ApiEnvironment } from './platform/tokens.js';
import { PrismaService } from './platform/prisma.service.js';

@Module({})
export class AppModule {
  static forRoot(environment: ApiEnvironment, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthContextController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: API_LOGGER, useValue: logger },
        InfrastructureService,
        PrismaService,
        SessionService,
        ContextThrottleService,
        { provide: PasswordService, useFactory: () => new PasswordService() },
        { provide: APP_GUARD, useClass: CsrfGuard },
      ],
    };
  }
}
