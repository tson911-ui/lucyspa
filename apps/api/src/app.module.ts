import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MyAccountController } from './account/my-account.controller.js';
import { MyAccountService } from './account/my-account.service.js';
import { AuthContextController } from './auth/auth-context.controller.js';
import { AuthThrottleService } from './auth/auth-throttle.service.js';
import { ContextThrottleService } from './auth/context-throttle.service.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { EmployeeSetupController } from './auth/employee-setup.controller.js';
import { EmployeeSetupService } from './auth/employee-setup.service.js';
import { LoginService } from './auth/login.service.js';
import { PasswordResetController } from './auth/password-reset.controller.js';
import { PasswordResetService } from './auth/password-reset.service.js';
import { PasswordService } from './auth/password.service.js';
import { RecoveryEmailController } from './auth/recovery-email.controller.js';
import { RecoveryEmailService } from './auth/recovery-email.service.js';
import { RegistrationController } from './auth/registration.controller.js';
import { RegistrationService } from './auth/registration.service.js';
import { SessionActivityInterceptor } from './auth/session-activity.js';
import { SessionAuthController } from './auth/session-auth.controller.js';
import { SessionService } from './auth/session.service.js';
import { AttendanceController } from './attendance/attendance.controller.js';
import { AttendanceService } from './attendance/attendance.service.js';
import { AuditReadService } from './authorization/audit-read.service.js';
import { BranchController } from './branches/branch.controller.js';
import { BranchService } from './branches/branch.service.js';
import { ServiceCatalogController } from './catalog/service-catalog.controller.js';
import { ServiceCatalogService } from './catalog/service-catalog.service.js';
import { SkillController } from './skills/skill.controller.js';
import { SkillService } from './skills/skill.service.js';
import { LeaveController } from './leave/leave.controller.js';
import { LeaveService } from './leave/leave.service.js';
import { AuthorizationAdminController } from './authorization/authorization-admin.controller.js';
import { RoleAdminService } from './authorization/role-admin.service.js';
import { EmployeeController } from './employees/employee.controller.js';
import { EmployeeDirectoryService } from './employees/employee-directory.service.js';
import { EmployeeService } from './employees/employee.service.js';
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
        EmployeeSetupController,
        EmployeeController,
        AuthorizationAdminController,
        BranchController,
        ServiceCatalogController,
        SkillController,
        AttendanceController,
        LeaveController,
        MyAccountController,
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
        EmployeeSetupService,
        EmployeeService,
        EmployeeDirectoryService,
        RoleAdminService,
        AuditReadService,
        BranchService,
        ServiceCatalogService,
        SkillService,
        AttendanceService,
        LeaveService,
        MyAccountService,
        { provide: PasswordService, useFactory: () => new PasswordService() },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_INTERCEPTOR, useClass: SessionActivityInterceptor },
      ],
    };
  }
}
