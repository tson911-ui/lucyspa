import 'reflect-metadata';
import assert from 'node:assert/strict';
import { type Server } from 'node:http';
import { after, before, test } from 'node:test';
import type { ApiErrorResponse } from '@lucy-spa/contracts';
import { parseApiEnvironment } from '@lucy-spa/server';
import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString, Length } from 'class-validator';
import { pino } from 'pino';
import request from 'supertest';
import { AppModule } from './app.module.js';
import { configureHttp } from './platform/configure-http.js';
import { InfrastructureService } from './platform/infrastructure.service.js';

class ValidationFixtureDto {
  @IsString()
  @Length(1, 20)
  label!: string;
}

// This controller exists only in the test module; it is never registered by AppModule.
@Controller('test-fixture')
class TestFixtureController {
  @Post('validate')
  validate(@Body() input: ValidationFixtureDto): ValidationFixtureDto {
    return input;
  }

  @Get('unexpected-error')
  unexpectedError(): never {
    throw new Error('database connection password=do-not-expose');
  }

  @Get('http-error')
  httpError(): never {
    throw new InternalServerErrorException('provider secret=do-not-expose');
  }
}

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  SWAGGER_ENABLED: 'true',
});
const logs: string[] = [];
const logger = pino(
  { level: 'info' },
  {
    write: (message: string) => {
      logs.push(message);
    },
  },
);
let databaseAvailable = true;
let redisAvailable = true;
let app: INestApplication;
let server: Server;

before(async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(environment, logger)],
    controllers: [TestFixtureController],
  })
    .overrideProvider(InfrastructureService)
    .useValue({
      pingDatabase: () =>
        databaseAvailable ? Promise.resolve() : Promise.reject(new Error('database secret')),
      pingRedis: () =>
        redisAvailable ? Promise.resolve() : Promise.reject(new Error('redis secret')),
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, logger);
  await app.init();
  server = app.getHttpServer() as Server;
});

after(async () => {
  await app.close();
});

test('liveness responds independently of dependencies and creates a fresh request ID', async () => {
  const response = await request(server)
    .get('/health/live')
    .set('x-request-id', 'untrusted-request-id')
    .expect(200);
  assert.deepEqual(response.body, { status: 'ok', service: 'api' });
  assert.match(String(response.headers['x-request-id']), /^[a-f0-9-]{36}$/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('readiness checks both dependencies and reports sanitized failures', async () => {
  const healthy = await request(server).get('/health/ready').expect(200);
  assert.deepEqual(healthy.body, {
    status: 'ok',
    service: 'api',
    checks: { database: 'up', redis: 'up' },
  });

  databaseAvailable = false;
  try {
    const databaseFailure = await request(server).get('/health/ready').expect(503);
    assert.deepEqual(databaseFailure.body, {
      status: 'error',
      service: 'api',
      checks: { database: 'down', redis: 'up' },
    });
    await request(server).get('/health/live').expect(200);
  } finally {
    databaseAvailable = true;
  }

  redisAvailable = false;
  try {
    const redisFailure = await request(server).get('/health/ready').expect(503);
    assert.deepEqual(redisFailure.body, {
      status: 'error',
      service: 'api',
      checks: { database: 'up', redis: 'down' },
    });
  } finally {
    redisAvailable = true;
  }
});

test('global validation rejects extra properties and invalid DTO types', async () => {
  const extra = await request(server)
    .post('/test-fixture/validate')
    .send({ label: 'valid', unexpected: 'value' })
    .expect(400);
  assert.equal((extra.body as ApiErrorResponse).code, 'HTTP_400');
  await request(server).post('/test-fixture/validate').send({ label: 123 }).expect(400);
  await request(server).post('/test-fixture/validate').send({}).expect(400);
  await request(server)
    .post('/test-fixture/validate')
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
  const valid = await request(server)
    .post('/test-fixture/validate')
    .send({ label: 'valid' })
    .expect(201);
  assert.deepEqual(valid.body, { label: 'valid' });
});

test('unhandled and HTTP server errors never expose internal exception details', async () => {
  for (const path of ['unexpected-error', 'http-error']) {
    const response = await request(server).get(`/test-fixture/${path}`).expect(500);
    const body = response.body as ApiErrorResponse;
    assert.equal(body.message, 'Internal server error');
    assert.equal(body.code, 'HTTP_500');
    assert.equal(body.requestId, response.headers['x-request-id']);
    assert.doesNotMatch(response.text, /do-not-expose|password|provider/);
  }
});

test('unknown routes and logs do not echo URL, query, authorization or body values', async () => {
  const response = await request(server)
    .post('/unknown-do-not-expose?token=do-not-expose')
    .set('Authorization', 'Bearer do-not-expose')
    .send({ password: 'do-not-expose' })
    .expect(404);
  assert.equal((response.body as ApiErrorResponse).message, 'Not Found');
  assert.doesNotMatch(response.text, /do-not-expose/);
  assert.doesNotMatch(logs.join('\n'), /do-not-expose|database secret|redis secret/);
  assert.match(logs.join('\n'), /requestId/);
});

test('OpenAPI describes only registered HTTP endpoints and dependency health schemas', async () => {
  const response = await request(server).get('/openapi.json').expect(200);
  const document = response.body as {
    paths: Record<string, unknown>;
    components: { schemas: Record<string, unknown> };
  };
  assert.ok(document.paths['/health/live']);
  assert.ok(document.paths['/health/ready']);
  assert.ok(document.components.schemas['HealthResponseDto']);
});

test('OpenAPI is absent when documentation is disabled', async () => {
  const disabledEnvironment = { ...environment, swaggerEnabled: false };
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(disabledEnvironment, logger)],
  })
    .overrideProvider(InfrastructureService)
    .useValue({ pingDatabase: () => Promise.resolve(), pingRedis: () => Promise.resolve() })
    .compile();
  const privateDocsApp = module.createNestApplication({ logger: false });
  configureHttp(privateDocsApp, disabledEnvironment, logger);
  try {
    await privateDocsApp.init();
    await request(privateDocsApp.getHttpServer() as Server)
      .get('/docs')
      .expect(404);
    await request(privateDocsApp.getHttpServer() as Server)
      .get('/openapi.json')
      .expect(404);
  } finally {
    await privateDocsApp.close();
  }
});
