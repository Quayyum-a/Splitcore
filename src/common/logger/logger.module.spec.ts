/**
 * Unit tests for log redaction (phase-1-production-ready task 17.1).
 *
 * A tipping platform logs every request. If a bearer token, a password, or a
 * BVN reaches the log aggregator in clear text, the aggregator becomes the
 * weakest link in the system — so redaction is asserted, not assumed.
 */

import { ConfigService } from '@nestjs/config';
import pino from 'pino';
import { Writable } from 'stream';
import { getPinoOptions } from './logger.module';

/** The shipped factory, run with a given environment. */
function optionsFor(nodeEnv: string, logLevel = 'info') {
  const config = {
    get: jest.fn((key: string) => (key === 'nodeEnv' ? nodeEnv : logLevel)),
  } as unknown as ConfigService;

  return getPinoOptions(config).pinoHttp;
}

/** Logs `payload` through a pino instance configured exactly as the app is. */
function logThrough(redact: { paths: string[]; censor: string }, payload: object): string {
  let captured = '';
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      captured += chunk.toString();
      callback();
    },
  });

  pino({ redact }, sink).info(payload, 'request completed');
  return captured;
}

describe('LoggerModule redaction', () => {
  const redact = optionsFor('production').redact;

  it('redacts the Authorization header', () => {
    const line = logThrough(redact, {
      req: { headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret' } },
    });

    expect(line).not.toContain('eyJhbGciOiJIUzI1NiJ9.secret');
    expect(line).toContain('[redacted]');
  });

  it('redacts cookies', () => {
    const line = logThrough(redact, { req: { headers: { cookie: 'session=abc123' } } });

    expect(line).not.toContain('session=abc123');
  });

  it.each([
    ['password', 'sup3rsecret'],
    ['passwordHash', '$2a$12$abcdefghijklmnop'],
    ['bvn', '22123456789'],
    ['nin', '12345678901'],
  ])('redacts req.body.%s', (field, value) => {
    const line = logThrough(redact, { req: { body: { [field]: value } } });

    expect(line).not.toContain(value);
    expect(line).toContain('[redacted]');
  });

  it('leaves non-sensitive fields readable', () => {
    const line = logThrough(redact, { req: { body: { email: 'guest@example.com' } } });

    expect(line).toContain('guest@example.com');
  });
});

describe('LoggerModule configuration', () => {
  it('emits raw JSON in production, for log aggregators', () => {
    expect(optionsFor('production').transport).toBeUndefined();
  });

  it('pretty-prints locally, for humans', () => {
    expect(optionsFor('development').transport).toMatchObject({ target: 'pino-pretty' });
  });

  it('honours the configured log level', () => {
    expect(optionsFor('production', 'warn').level).toBe('warn');
  });

  it('reuses an inbound request id so a trace survives across services', () => {
    expect(optionsFor('production').genReqId({ headers: { 'x-request-id': 'trace-abc' } })).toBe(
      'trace-abc',
    );
  });

  it('generates a request id when the caller supplies none', () => {
    expect(optionsFor('production').genReqId({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    [200, 'info'],
    [404, 'warn'],
    [500, 'error'],
  ])('logs a %s response at %s', (statusCode, expected) => {
    expect(optionsFor('production').customLogLevel({}, { statusCode }, undefined)).toBe(expected);
  });

  it('logs at error level whenever an error is attached, whatever the status', () => {
    expect(
      optionsFor('production').customLogLevel({}, { statusCode: 200 }, new Error('boom')),
    ).toBe('error');
  });
});
