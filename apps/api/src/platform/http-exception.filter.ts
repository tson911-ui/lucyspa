import { STATUS_CODES } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ApiErrorResponse } from '@lucy-spa/contracts';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { Logger } from 'pino';
import { AuthError } from '../auth/auth.error.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    const requestIdHeader = response.getHeader('x-request-id');
    const requestId = typeof requestIdHeader === 'string' ? requestIdHeader : randomUUID();
    const body: ApiErrorResponse = {
      statusCode,
      code: exception instanceof AuthError ? exception.code : `HTTP_${statusCode}`,
      // Even framework 404s may echo an incoming URL containing sensitive data.
      // Domain errors are allowlisted; other exceptions expose standard messages only.
      message:
        exception instanceof AuthError
          ? exception.message
          : statusCode >= 500
            ? 'Internal server error'
            : (STATUS_CODES[statusCode] ?? 'Request failed'),
      requestId,
    };
    if (statusCode >= 500) {
      this.logger.error({ requestId, statusCode }, 'Unhandled API request error');
    }
    response.setHeader('x-request-id', requestId);
    response.status(statusCode).json(body);
  }
}
