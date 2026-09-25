/**
 * Unit tests for the single error filter every response passes through.
 *
 * Covers phase-1-production-ready task 15.1.
 */

import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';

function buildHost(url = '/payments/initialize', method = 'POST') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url, method, user: undefined }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json, body: () => json.mock.calls[0][0] };
}

function buildFilter() {
  const logger = { error: jest.fn() } as unknown as Logger;
  return { filter: new AllExceptionsFilter(logger), logger };
}

describe('AllExceptionsFilter', () => {
  it('preserves the status and message of a thrown HttpException', () => {
    const { filter } = buildFilter();
    const { host, status, body } = buildHost();

    filter.catch(new NotFoundException('Payment not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(body()).toMatchObject({
      statusCode: 404,
      error: 'NotFoundException',
      message: 'Payment not found',
      path: '/payments/initialize',
    });
    expect(typeof body().timestamp).toBe('string');
  });

  it('keeps the array of messages a validation failure produces', () => {
    const { filter } = buildFilter();
    const { host, body } = buildHost();

    filter.catch(
      new BadRequestException({
        message: ['amountKobo must be an integer', 'email must be valid'],
      }),
      host,
    );

    expect(body().message).toEqual(['amountKobo must be an integer', 'email must be valid']);
  });

  it('does not log an intentional 4xx as a bug', () => {
    const { filter, logger } = buildFilter();
    const { host } = buildHost();

    filter.catch(new UnauthorizedException(), host);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('turns an unexpected error into a 500 with no internal detail leaked', () => {
    const { filter, logger } = buildFilter();
    const { host, status, body } = buildHost();

    filter.catch(new Error('column "secret_key" does not exist'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body()).toMatchObject({
      statusCode: 500,
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(body())).not.toContain('secret_key');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  describe('errors raised by Express before Nest sees the request', () => {
    it('maps an oversized body to 413 rather than 500', () => {
      const { filter } = buildFilter();
      const { host, status, body } = buildHost();

      const payloadTooLarge = Object.assign(new Error('request entity too large'), {
        status: 413,
        statusCode: 413,
        type: 'entity.too.large',
      });

      filter.catch(payloadTooLarge, host);

      expect(status).toHaveBeenCalledWith(413);
      expect(body().message).toBe('Request payload is too large');
    });

    it('does not report a rejected client request to the error log', () => {
      const { filter, logger } = buildFilter();
      const { host } = buildHost();

      filter.catch(Object.assign(new Error('entity.parse.failed'), { status: 400 }), host);

      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not leak the parser message to the client', () => {
      const { filter } = buildFilter();
      const { host, body } = buildHost();

      filter.catch(
        Object.assign(new Error('Unexpected token } in JSON at position 42'), { status: 400 }),
        host,
      );

      expect(body().message).toBe('Malformed request');
    });

    it('still treats a framework 5xx as an unexpected failure', () => {
      const { filter, logger } = buildFilter();
      const { host, status, body } = buildHost();

      filter.catch(Object.assign(new Error('upstream exploded'), { status: 502 }), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body().message).toBe('An unexpected error occurred');
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('ignores a non-numeric status on a thrown value', () => {
      const { filter } = buildFilter();
      const { host, status } = buildHost();

      filter.catch(Object.assign(new Error('weird'), { status: 'nope' }), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('handles a thrown non-object without crashing the filter', () => {
      const { filter } = buildFilter();
      const { host, status, body } = buildHost();

      filter.catch('something threw a string', host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body().message).toBe('An unexpected error occurred');
    });
  });
});
