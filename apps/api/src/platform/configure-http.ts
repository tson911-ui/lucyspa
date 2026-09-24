import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { HttpExceptionFilter } from './http-exception.filter.js';
import type { ApiEnvironment } from './tokens.js';

export function configureHttp(
  app: INestApplication,
  environment: ApiEnvironment,
  logger: Logger,
): void {
  app.use((_request: Request, response: Response, next: NextFunction) => {
    const startedAt = performance.now();
    const requestId = randomUUID();
    response.setHeader('x-request-id', requestId);
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.once('finish', () => {
      logger.info(
        {
          requestId,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'HTTP request completed',
      );
    });
    next();
  });
  app.enableCors({ origin: environment.webOrigin });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  if (environment.swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Lucy Spa API')
      .setDescription(
        'Infrastructure and authentication context foundation. Authentication workflows are introduced in later steps.',
      )
      .setVersion('0.0.0')
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
      jsonDocumentUrl: 'openapi.json',
    });
  }
}
