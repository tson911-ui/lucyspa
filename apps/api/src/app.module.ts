import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_GUARD } from '@nestjs/core';
import { AuthContextController } from './auth/auth-context.controller.js';
import { AuthThrottleService } from './auth/auth-throttle.service.js';
import { ContextThrottleService } from './auth/context-throttle.service.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { LoginService } from './auth/login.service.js';
import { PasswordResetController } from './auth/password-reset.controller.js';
import { PasswordResetService } from './auth/password-reset.service.js';
import { PasswordService } from './auth/password.service.js';
import { RecoveryEmailController } from './auth/recovery-email.controller.js';
import { RecoveryEmailService } from './auth/recovery-email.service.js';
import { RegistrationController } from './auth/registration.controller.js';
import { RegistrationService } from './auth/registration.service.js';
import { SessionAuthController } from './auth/session-auth.controller.js';
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
      controllers: [
        HealthController,
        AuthContextController,
        RegistrationController,
        SessionAuthController,
        PasswordResetController,
        RecoveryEmailController,
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: API_LOGGER, useValue: logger },
        InfrastructureService,
        PrismaService,
        SessionService,
        ContextThrottleService,
        AuthThrottleService,
        RegistrationService,
        LoginService,
        PasswordResetService,
        RecoveryEmailService,
        { provide: PasswordService, useFactory: () => new PasswordService() },
        { provide: APP_GUARD, useClass: CsrfGuard },
      ],
    };
  }
}
