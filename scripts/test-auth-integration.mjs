// Explicit entry point; ordinary unit tests never access the configured database.
process.env['RUN_AUTH_INTEGRATION'] = 'true';
await import('../apps/api/dist/auth/session.integration.test.js');
await import('../apps/api/dist/auth/registration.integration.test.js');
await import('../apps/api/dist/auth/login.integration.test.js');
await import('../apps/api/dist/auth/password-reset.integration.test.js');
await import('../apps/api/dist/authorization/authorization.integration.test.js');
await import('../apps/api/dist/bootstrap/workforce-auth.integration.test.js');
await import('../apps/api/dist/auth/workforce-recovery.integration.test.js');
await import('../apps/api/dist/employees/employee.integration.test.js');
await import('../apps/api/dist/authorization/role-admin.integration.test.js');
await import('../apps/api/dist/auth/email-dispatch.integration.test.js');
await import('../apps/api/dist/branches/branch.integration.test.js');
