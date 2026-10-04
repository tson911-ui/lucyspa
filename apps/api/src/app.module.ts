import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EmailChangeService } from './account/email-change.service.js';
import {
  CollaboratorWorkController,
  MyCollaboratorWorkController,
} from './collaborator-work/collaborator-work.controller.js';
import { CollaboratorWorkService } from './collaborator-work/collaborator-work.service.js';
import {
  MyAccountController,
  MyEmailController,
  MyIncomeController,
  MyPasswordController,
} from './account/my-account.controller.js';
import { MyIncomeService } from './account/my-income.service.js';
import { CustomerBookingController } from './booking/customer-booking.controller.js';
import { CustomerBookingService } from './booking/customer-booking.service.js';
import { OperationsController } from './operations/operations.controller.js';
import { OperationsService } from './operations/operations.service.js';
import { ServiceExecutionController } from './operations/service-execution.controller.js';
import { ServiceExecutionService } from './operations/service-execution.service.js';
import { ReassignmentController } from './operations/reassignment.controller.js';
import { ReassignmentService } from './operations/reassignment.service.js';
import { NotificationController } from './notifications/notification.controller.js';
import { NotificationService } from './notifications/notification.service.js';
import { DiscountController } from './discounts/discount.controller.js';
import { DiscountService } from './discounts/discount.service.js';
import { ComboController } from './combo/combo.controller.js';
import { ComboService } from './combo/combo.service.js';
import { LoyaltyController } from './loyalty/loyalty.controller.js';
import { LoyaltyService } from './loyalty/loyalty.service.js';
import { ReferralController } from './referral/referral.controller.js';
import { ReferralService } from './referral/referral.service.js';
import { CustomerInvoiceController } from './pos/customer-invoice.controller.js';
import { CustomerInvoiceService } from './pos/customer-invoice.service.js';
import { InvoiceController } from './pos/invoice.controller.js';
import { InvoiceService } from './pos/invoice.service.js';
import { PayosWebhookController, PayosWebhookService } from './pos/payos.webhook.js';
import { createPayosProvider, LocalDiskMediaStorage } from '@lucy-spa/server';
import { WalkInController } from './walkin/walkin.controller.js';
import { WalkInService } from './walkin/walkin.service.js';
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
import { AvailabilityService } from './availability/availability.service.js';
import { AuthorizationAdminController } from './authorization/authorization-admin.controller.js';
import { RoleAdminService } from './authorization/role-admin.service.js';
import { EmployeeController } from './employees/employee.controller.js';
import { EmployeeDirectoryService } from './employees/employee-directory.service.js';
import { EmployeeService } from './employees/employee.service.js';
import { OrganizationController } from './organization/organization.controller.js';
import { OrganizationService } from './organization/organization.service.js';
import { TeamController } from './teams/team.controller.js';
import { TeamService } from './teams/team.service.js';
import { MediaController } from './website/media.controller.js';
import { MediaService } from './website/media.service.js';
import { PopupController, PublicWebsiteController } from './website/popup.controller.js';
import { ShopInfoController } from './website/shop-info.controller.js';
import { ShopInfoService } from './website/shop-info.service.js';
import { PopupService, PublicWebsiteService } from './website/popup.service.js';
import { SeasonController } from './website/season.controller.js';
import { SeasonService } from './website/season.service.js';
import { SlideController } from './website/slide.controller.js';
import { SlideService } from './website/slide.service.js';
import { HealthController } from './health/health.controller.js';
import { InfrastructureService } from './platform/infrastructure.service.js';
import {
  API_ENVIRONMENT,
  API_LOGGER,
  MEDIA_STORAGE,
  PAYMENT_PROVIDER,
  type ApiEnvironment,
} from './platform/tokens.js';
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
        MyPasswordController,
        MyEmailController,
        CollaboratorWorkController,
        MyCollaboratorWorkController,
        MyIncomeController,
        CustomerBookingController,
        OperationsController,
        ServiceExecutionController,
        ReassignmentController,
        NotificationController,
        WalkInController,
        DiscountController,
        ComboController,
        LoyaltyController,
        ReferralController,
        InvoiceController,
        CustomerInvoiceController,
        PayosWebhookController,
        OrganizationController,
        TeamController,
        MediaController,
        PopupController,
        SlideController,
        SeasonController,
        ShopInfoController,
        PublicWebsiteController,
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: API_LOGGER, useValue: logger },
        {
          // PayOS only when all three credentials are configured; otherwise the method is disabled.
          provide: PAYMENT_PROVIDER,
          useValue: environment.payos ? createPayosProvider(environment.payos) : null,
        },
        // Website media objects live under MEDIA_STORAGE_DIR (outside the release folder; in the backup scope).
        {
          provide: MEDIA_STORAGE,
          useValue: new LocalDiskMediaStorage(environment.mediaStorageDir),
        },
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
        EmailChangeService,
        CollaboratorWorkService,
        MyIncomeService,
        AvailabilityService,
        CustomerBookingService,
        OperationsService,
        ServiceExecutionService,
        ReassignmentService,
        NotificationService,
        WalkInService,
        DiscountService,
        ComboService,
        LoyaltyService,
        ReferralService,
        InvoiceService,
        CustomerInvoiceService,
        PayosWebhookService,
        OrganizationService,
        TeamService,
        MediaService,
        PopupService,
        SlideService,
        SeasonService,
        ShopInfoService,
        PublicWebsiteService,
        { provide: PasswordService, useFactory: () => new PasswordService() },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_INTERCEPTOR, useClass: SessionActivityInterceptor },
      ],
    };
  }
}
