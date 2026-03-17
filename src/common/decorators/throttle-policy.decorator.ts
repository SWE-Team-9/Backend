import { applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

export const ThrottlePolicy = (limit: number, ttlMs: number) =>
  applyDecorators(
    Throttle({
      default: {
        limit,
        ttl: ttlMs,
      },
    }),
  );