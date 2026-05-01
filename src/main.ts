import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SocketIoAdapter } from './common/adapters/socket-io.adapter';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import * as path from 'path';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './common/filters/global-http-exception.filter';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Disable NestJS's built-in body parsers so we can register our own with
    // custom size limits (see express.json / express.urlencoded below).
    // This also prevents a double-parser conflict: NestJS's default json
    // parser would consume the request stream before multer's FileInterceptor
    // can process multipart/form-data uploads.
    bodyParser: false,
    // Suppress NestJS startup logs in production to avoid leaking internals
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn']
        : ['error', 'warn', 'log', 'verbose', 'debug'],
  });

  const isProduction = process.env.NODE_ENV === 'production';

  // ── Trust proxy ─────────────────────────────────────────────────────────────
  // Required so Express populates req.ip correctly when sitting behind a load
  // balancer or reverse proxy (nginx, AWS ALB, etc.).
  // ThrottlerGuard and our IP-extraction utility depend on this.
  // '1' = trust one hop (the immediate upstream proxy).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // ── Global prefix ────────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Helmet - Relaxed for development/MVP ──────────────────────────────────────
  // Security headers are less strict to allow frontend integration.
  app.use(
    helmet({
      // Relaxed CSP for development - allows self and unsafe-inline
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },

      // X-Frame-Options: DENY - belt-and-suspenders alongside frameAncestors.
      frameguard: { action: 'deny' },

      // HTTP Strict Transport Security - only in production where TLS is used.
      // Tells browsers to always use HTTPS for this domain for 1 year.
      hsts: isProduction
        ? {
            maxAge: 31_536_000, // 1 year in seconds
            includeSubDomains: true,
            preload: true,
          }
        : false,

      // X-Content-Type-Options: nosniff
      // Prevents browsers from MIME-sniffing a response away from its declared type.
      noSniff: true,

      // X-XSS-Protection: 0
      // Modern recommendation is to DISABLE the legacy XSS filter (can introduce
      // vulnerabilities) and rely on CSP instead.
      xssFilter: false,

      // Referrer-Policy: no-referrer
      // Prevents the API URL from leaking in the Referer header of outbound requests.
      referrerPolicy: { policy: 'no-referrer' },

      // Cross-Origin-Resource-Policy: cross-origin
      // Allow cross-origin reads (needed for the SPA frontend to consume the API).
      crossOriginResourcePolicy: { policy: 'cross-origin' },

      // Cross-Origin-Opener-Policy: same-origin
      // Isolates the browsing context to prevent cross-origin document access.
      crossOriginOpenerPolicy: { policy: 'same-origin' },

      // Cross-Origin-Embedder-Policy: credentialless
      // Prevents documents from loading cross-origin resources that do not grant
      // permission - defence-in-depth for Spectre-style attacks.
      crossOriginEmbedderPolicy: false, // keep off - breaks some OAuth redirects

      // Permissions-Policy - revoke access to sensitive browser APIs.
      // helmet does not set this natively; we add it as a custom header below.
    }),
  );

  // ── Permissions-Policy header (OWASP A05) ───────────────────────────────────
  // Explicitly disable browser features this API has no business using.
  app.use((_req: any, res: any, next: any) => {
    res.setHeader(
      'Permissions-Policy',
      [
        'camera=()',
        'microphone=()',
        'geolocation=()',
        'interest-cohort=()',
        'payment=()',
        'usb=()',
        'bluetooth=()',
        'accelerometer=()',
        'gyroscope=()',
        'magnetometer=()',
      ].join(', '),
    );
    next();
  });

  // ── Request body size limit - OWASP A05 / DoS prevention ────────────────────
  // Since we disabled NestJS's default body parser (bodyParser: false above),
  // these are now the ONLY JSON/urlencoded parsers on the Express stack.
  // Reject large payloads before they reach any controller.
  // Multer (file uploads) has its own per-route size limits via FileInterceptor.

  // Stripe webhook requires the raw body for HMAC signature verification.
  // This middleware captures raw bytes before JSON parsing, for the webhook route.
  app.use(
    '/api/v1/subscriptions/webhook',
    require('express').raw({ type: 'application/json', limit: '64kb' }),
    (req: any, _res: any, next: any) => {
      req.rawBody = req.body; // preserve Buffer for signature check
      next();
    },
  );

  app.use(require('express').json({ limit: '64kb' }));
  app.use(require('express').urlencoded({ extended: true, limit: '64kb' }));

  // ── Cookie parser ────────────────────────────────────────────────────────────
  // Required to read httpOnly auth cookies in guards and controllers.
  app.use(cookieParser());

  // ── Local static file serving ────────────────────────────────────────────────
  // Serves uploaded images and audio from /uploads when using local storage.
  // Placed before CORS so paths remain /uploads/... (not wrapped in global prefix).
  //
  // SECURITY: Audio track files are private content — they must only be served
  // to authenticated users. Public image assets (avatars, cover art) can remain
  // unauthenticated since they are intended to be publicly visible.
  if (process.env.STORAGE_PROVIDER !== 's3') {
    const uploadDir = path.resolve(process.env.LOCAL_UPLOAD_DIR ?? './uploads');

    // Retrieve config values from the NestJS DI container so we reuse the same
    // JWT settings as the strategy (avoids duplicating env variable names).
    const configService = app.get(ConfigService);
    const prismaService = app.get(PrismaService);
    const jwtSecret =
      configService.get<string>('security.jwtSecret') ?? process.env.JWT_SECRET ?? '';
    const jwtIssuer = configService.get<string>('security.jwtIssuer') ?? 'spotly-api';
    const jwtAudience = configService.get<string>('security.jwtAudience') ?? 'spotly-client';

    // Public image assets — avatars and cover art are not sensitive.
    app.use('/uploads/avatar', require('express').static(path.join(uploadDir, 'avatar')));
    app.use('/uploads/cover', require('express').static(path.join(uploadDir, 'cover')));

    // Public preview clips — short 30-second clips intentionally accessible to all
    // users (free-tier preview). No auth required; these are not full tracks.
    app.use('/uploads/previews', require('express').static(path.join(uploadDir, 'previews')));

    // Protected audio assets — require a valid, non-revoked JWT.
    // Note: cookieParser() is registered above so req.cookies is available here.
    app.use('/uploads/tracks', async (req: any, res: any, next: any) => {
      // Extract token from httpOnly cookie (browser) or Authorization header
      // (non-browser clients such as mobile apps).
      const token: string | undefined =
        req.cookies?.access_token ?? req.headers?.authorization?.replace(/^Bearer\s+/i, '');

      if (!token) {
        return res.status(401).json({
          statusCode: 401,
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication is required to stream audio.',
        });
      }

      let payload: any;
      try {
        payload = jwt.verify(token, jwtSecret, {
          issuer: jwtIssuer,
          audience: jwtAudience,
        });
      } catch {
        return res.status(401).json({
          statusCode: 401,
          code: 'NOT_AUTHENTICATED',
          message: 'Invalid or expired token.',
        });
      }

      // If the token carries a session ID (jti), verify the session is still
      // active in the database. This enforces immediate revocation after logout.
      if (payload?.jti) {
        try {
          const session = await prismaService.userSession.findUnique({
            where: { id: payload.jti },
            select: { revokedAt: true, expiresAt: true },
          });
          if (session?.revokedAt !== null || session.expiresAt < new Date()) {
            return res.status(401).json({
              statusCode: 401,
              code: 'SESSION_REVOKED',
              message: 'Session has been revoked. Please log in again.',
            });
          }
        } catch {
          // Treat DB errors conservatively — deny access rather than fail open.
          return res.status(503).json({
            statusCode: 503,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Unable to verify session. Please try again.',
          });
        }
      }

      next();
    });
    app.use('/uploads/tracks', require('express').static(path.join(uploadDir, 'tracks')));
  }

  // ── CORS ─────────────────────────────────────────────────────────────────────
  // CORS is a browser security mechanism. It only affects web browsers - mobile
  // apps and server-to-server calls are NOT restricted by CORS at all.
  //
  // For browsers, we need to explicitly allow each frontend origin.
  // Since our auth uses httpOnly cookies, we MUST restrict to known origins -
  // otherwise any website could silently trigger authenticated requests on
  // behalf of your users (CSRF via cookie attachment).
  //
  // ALLOWED_ORIGINS in .env is a comma-separated list of allowed URLs, e.g.:
  //   ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4200
  // Add the cross-team frontend URL there when you have it.
  // Built-in dev origins always allowed regardless of env config.
  // Add any new frontend local dev port here so teams don't need to touch .env.
  const defaultDevOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4200',
    'http://localhost:5173',
    'http://localhost:8080',
  ];

  const rawOrigins = process.env.ALLOWED_ORIGINS ?? process.env.CLIENT_URL ?? '';
  const envOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Merge env-configured origins with the hardcoded dev defaults (deduplicated)
  const allowedOrigins = [...new Set([...defaultDevOrigins, ...envOrigins])];

  app.enableCors({
    // Pass the array to Express - it will match the incoming Origin header
    // against this list and reflect back only the matched one.
    // If the origin is not in the list the browser gets no CORS headers
    // and blocks the request.
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 600,
  });

  // ── Global ValidationPipe - OWASP A03 (Injection) ───────────────────────────
  // - whitelist         : strips properties not defined in the DTO class.
  // - forbidNonWhitelisted : rejects requests that include extra properties.
  // - transform         : auto-converts query strings to their DTO types.
  // - transformOptions  : enables implicit type conversion (e.g. "true" -> true).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
      // Limit the size of the parsed payload to prevent prototype-pollution
      // attacks via deeply nested objects.
      stopAtFirstError: false,
    }),
  );

  // ── Global exception filter - OWASP A05 ─────────────────────────────────────
  // Ensures every error response follows the same { statusCode, error, message,
  // timestamp, path } shape.  Never leaks stack traces or internal details.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  // ── Start ────────────────────────────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3000);

  // ── Swagger ──────────────────────────────────────────────────────────────────
  // By default Swagger is ON in development and OFF in production.
  // You can override this by setting SWAGGER_ENABLED=true in .env
  // (useful for team/staging servers where NODE_ENV=production but you
  // still need the docs - e.g. for Postman import or cross-team integration).
  const swaggerEnabled = process.env.SWAGGER_ENABLED === 'true' || !isProduction;

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('IQA3 API')
      .setDescription('Social Streaming Platform backend API documentation.')
      .setVersion('1.0')
      .addCookieAuth('access_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
      })
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Use a single shared socket.io Server for all gateways so multiple
  // @WebSocketGateway decorators don't each spin up their own Server on the
  // same HTTP port (which causes upgrade-event conflicts and silent failures).
  app.useWebSocketAdapter(new SocketIoAdapter(app));

  await app.listen(port);

  if (!isProduction) {
    console.log(`🚀 API running at http://localhost:${port}/api/v1`);
    console.log(`   Health check: http://localhost:${port}/api/v1/health`);
  }
}

void bootstrap();
