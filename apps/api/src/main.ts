import 'reflect-metadata';
import { createLogger, parseApiEnvironment } from '@lucy-spa/server';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { configureHttp } from './platform/configure-http.js';

const startupLogger = createLogger('api', 'info');
let app: INestApplication | undefined;

try {
  const environment = parseApiEnvironment(process.env);
  const logger = createLogger('api', environment.logLevel);
  app = await NestFactory.create(AppModule.forRoot(environment, logger), {
    logger: false,
    abortOnError: false,
  });
  configureHttp(app, environment, logger);
  app.enableShutdownHooks();
  await app.listen(environment.port, environment.host);
  logger.info({ host: environment.host, port: environment.port }, 'API started');
} catch {
  // Never print arbitrary startup errors: database URLs can contain credentials.
  startupLogger.fatal('API startup failed; verify environment and infrastructure availability');
  try {
    await app?.close();
  } catch {
    startupLogger.error('API cleanup failed after startup failure');
  }
  process.exitCode = 1;
}
