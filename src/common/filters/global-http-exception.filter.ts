import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

type ExceptionBody = {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  code?: string;
};

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
      ? (exception.getResponse() as string | ExceptionBody)
      : undefined;

    const parsed = this.parseExceptionResponse(exceptionResponse, status);

    response.status(status).json({
      statusCode: status,
      error: parsed.error,
      message: parsed.message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private parseExceptionResponse(
    exceptionResponse: string | ExceptionBody | undefined,
    status: number,
  ) {
    if (typeof exceptionResponse === 'string') {
      return {
        error: this.defaultErrorCode(status),
        message: exceptionResponse,
      };
    }

    if (exceptionResponse && typeof exceptionResponse === 'object') {
      const message = Array.isArray(exceptionResponse.message)
        ? exceptionResponse.message.join(', ')
        : (exceptionResponse.message ?? 'An unexpected error occurred.');

      return {
        error:
          exceptionResponse.code ??
          exceptionResponse.error ??
          this.defaultErrorCode(status),
        message,
      };
    }

    return {
      error: this.defaultErrorCode(status),
      message: 'An unexpected error occurred.',
    };
  }

  private defaultErrorCode(status: number) {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_FAILED';
      case HttpStatus.UNAUTHORIZED:
        return 'NOT_AUTHENTICATED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMIT_EXCEEDED';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }
}