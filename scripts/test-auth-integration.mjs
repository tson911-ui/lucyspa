// Explicit entry point; ordinary unit tests never access the configured database.
process.env['RUN_AUTH_INTEGRATION'] = 'true';
await import('../apps/api/dist/auth/session.integration.test.js');
await import('../apps/api/dist/auth/registration.integration.test.js');
await import('../apps/api/dist/auth/login.integration.test.js');
