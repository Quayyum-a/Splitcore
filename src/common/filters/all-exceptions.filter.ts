import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

// Every error the app throws — a validation failure, a not-found, an
// unhandled bug — passes through here exactly once, so the shape of an
// error response is guaranteed identical everywhere. A client (or a future
// mobile app, or a partner integrating against the API) should never need
// to guess whether an error looks different depending on which endpoint
// produced it.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttpException
      ? this.extractMessage(exception)
      : 'An unexpected error occurred';

    const body: ErrorResponseBody = {
      statusCode,
      error: isHttpException ? exception.constructor.name : 'InternalServerError',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    // Capture exceptions in Sentry for 5xx errors (500-599 status codes)
    if (statusCode >= 500 && statusCode < 600) {
      Sentry.captureException(exception, {
        contexts: {
          http: {
            method: request.method,
            url: request.url,
            status_code: statusCode,
          },
        },
        user: request.user
          ? {
              id: (request.user as any).userId,
              role: (request.user as any).role,
            }
          : undefined,
      });
    }

    // Anything not deliberately thrown as an HttpException is, by
    // definition, a bug or an unhandled edge case — those get logged with
    // the full stack every time, regardless of environment, because
    // silently swallowing an unexpected 500 is how "financial correctness"
    // quietly stops being true.
    if (!isHttpException) {
      this.logger.error(
        { err: exception, path: request.url, method: request.method },
        'Unhandled exception',
      );
    }

    response.status(statusCode).json(body);
  }

  private extractMessage(exception: HttpException): string | string[] {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null && 'message' in response) {
      return (response as { message: string | string[] }).message;
    }
    return exception.message;
  }
}
