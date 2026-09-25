import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

// Deliberately generic: a pre-Nest error's own message can name internals
// (limits, parser state) that a client has no business seeing.
const STATUS_MESSAGES: Record<number, string> = {
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Request payload is too large',
  [HttpStatus.BAD_REQUEST]: 'Malformed request',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported content type',
};

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
    // Express middleware that runs before Nest (body-parser, most visibly)
    // rejects with a plain Error carrying its own status. Without this, an
    // oversized request body surfaced to the client as a 500 — and got
    // reported to Sentry as a bug — rather than as 413 Payload Too Large.
    const frameworkStatus = isHttpException ? undefined : this.extractFrameworkStatus(exception);

    const statusCode = isHttpException
      ? exception.getStatus()
      : (frameworkStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);

    const message = isHttpException
      ? this.extractMessage(exception)
      : frameworkStatus
        ? (STATUS_MESSAGES[frameworkStatus] ?? 'Request rejected')
        : 'An unexpected error occurred';

    const body: ErrorResponseBody = {
      statusCode,
      error: isHttpException
        ? exception.constructor.name
        : frameworkStatus
          ? 'BadRequestException'
          : 'InternalServerError',
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
    // quietly stops being true. A recognised 4xx from the framework is a
    // bad client request, not a bug, so it is not logged as one.
    if (!isHttpException && !frameworkStatus) {
      this.logger.error(
        { err: exception, path: request.url, method: request.method },
        'Unhandled exception',
      );
    }

    response.status(statusCode).json(body);
  }

  /**
   * A status a pre-Nest Express layer already decided on, when it is a
   * client error. 5xx is deliberately excluded: those stay 500s and keep
   * being logged and reported as unexpected.
   */
  private extractFrameworkStatus(exception: unknown): number | undefined {
    if (typeof exception !== 'object' || exception === null) return undefined;
    const candidate = exception as { status?: unknown; statusCode?: unknown };
    const status = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
    if (typeof status !== 'number' || status < 400 || status > 499) return undefined;
    return status;
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
