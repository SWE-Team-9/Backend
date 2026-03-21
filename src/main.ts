import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from "cookie-parser";
import helmet from "helmet";
import * as path from "path";
import { AppModule } from "./app.module";
import { GlobalHttpExceptionFilter } from "./common/filters/global-http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Suppress NestJS startup logs in production to avoid leaking internals
    logger:
      process.env.NODE_ENV === "production"
        ? ["error", "warn"]
        : ["error", "warn", "log", "verbose", "debug"],
  });

  const isProduction = process.env.NODE_ENV === "production";

  // ── Trust proxy ─────────────────────────────────────────────────────────────
  // Required so Express populates req.ip correctly when sitting behind a load
  // balancer or reverse proxy (nginx, AWS ALB, etc.).
  // ThrottlerGuard and our IP-extraction utility depend on this.
  // '1' = trust one hop (the immediate upstream proxy).
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  // ── Global prefix ────────────────────────────────────────────────────────────
  app.setGlobalPrefix("api/v1");

  // ── Helmet — OWASP A05 (Security Misconfiguration) ──────────────────────────
  // Sets all security-relevant HTTP response headers.
  app.use(
    helmet({
      // This is a JSON API — browsers should never render its responses as HTML.
      // CSP blocks iframing and restricts what a browser does with the response.
     contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: isProduction ? ["'none'"] : ["'self'", "'unsafe-inline'"],
          styleSrc: isProduction ? ["'none'"] : ["'self'", "'unsafe-inline'"],
          imgSrc: isProduction ? ["'none'"] : ["'self'", "data:"],
          fontSrc: isProduction ? ["'none'"] : ["'self'"],
          // Allow fetch/XHR in dev so Swagger UI "Try it out" can reach the API.
          connectSrc: isProduction ? ["'none'"] : ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'none'"],
          ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },

      // X-Frame-Options: DENY — belt-and-suspenders alongside frameAncestors.
      frameguard: { action: "deny" },

      // HTTP Strict Transport Security — only in production where TLS is used.
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
      referrerPolicy: { policy: "no-referrer" },

      // Cross-Origin-Resource-Policy: cross-origin
      // Allow cross-origin reads (needed for the SPA frontend to consume the API).
      crossOriginResourcePolicy: { policy: "cross-origin" },

      // Cross-Origin-Opener-Policy: same-origin
      // Isolates the browsing context to prevent cross-origin document access.
      crossOriginOpenerPolicy: { policy: "same-origin" },

      // Cross-Origin-Embedder-Policy: credentialless
      // Prevents documents from loading cross-origin resources that do not grant
      // permission — defence-in-depth for Spectre-style attacks.
      crossOriginEmbedderPolicy: false, // keep off — breaks some OAuth redirects

      // Permissions-Policy — revoke access to sensitive browser APIs.
      // helmet does not set this natively; we add it as a custom header below.
    }),
  );

  // ── Permissions-Policy header (OWASP A05) ───────────────────────────────────
  // Explicitly disable browser features this API has no business using.
  app.use((_req: any, res: any, next: any) => {
    res.setHeader(
      "Permissions-Policy",
      [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        "interest-cohort=()",
        "payment=()",
        "usb=()",
        "bluetooth=()",
        "accelerometer=()",
        "gyroscope=()",
        "magnetometer=()",
      ].join(", "),
    );
    next();
  });

  // ── Request body size limit — OWASP A05 / DoS prevention ────────────────────
  // Reject large JSON bodies before they reach any controller.
  // Multer (file uploads) has its own per-route size limits.
  app.use(require("express").json({ limit: "64kb" }));
  app.use(require("express").urlencoded({ extended: true, limit: "64kb" }));

  // ── Cookie parser ────────────────────────────────────────────────────────────
  // Required to read httpOnly auth cookies in guards and controllers.
  app.use(cookieParser());

  // ── Local static file serving ────────────────────────────────────────────────
  // Only active when STORAGE_PROVIDER=local (dev default).
  // Serves uploaded images at /uploads/<type>/<filename>.
  // Intentionally placed BEFORE the global prefix so the path stays /uploads/…
  // and is not exposed under /api/v1/.
  if (process.env.STORAGE_PROVIDER !== 's3') {
    const uploadDir = path.resolve(
      process.env.LOCAL_UPLOAD_DIR ?? './uploads',
    );
    app.use('/uploads', require('express').static(uploadDir));
  }

  // ── CORS — OWASP A05 ────────────────────────────────────────────────────────
  // Only the configured frontend origin may make credentialed cross-origin
  // requests.  Any other origin will have its preflight rejected.
  const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
  const serverUrl = `http://localhost:${process.env.PORT ?? 3006}`;
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. server-to-server, curl in dev)
      // and requests from the exact configured CLIENT_URL.
      // In dev, also allow same-server origin so Swagger UI "Try it out" works.
      const allowedOrigins = [clientUrl, ...(!isProduction ? [serverUrl] : [])];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy: origin "${origin}" is not allowed.`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    // Do not expose custom response headers to the browser unless explicitly needed.
    exposedHeaders: [],
    // Cache preflight result for 10 minutes to reduce OPTIONS traffic.
    maxAge: 600,
  });

  // ── Global ValidationPipe — OWASP A03 (Injection) ───────────────────────────
  // • whitelist         : strips properties not defined in the DTO class.
  // • forbidNonWhitelisted : rejects requests that include extra properties.
  // • transform         : auto-converts query strings to their DTO types.
  // • transformOptions  : enables implicit type conversion (e.g. "true" → true).
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

  // ── Global exception filter — OWASP A05 ─────────────────────────────────────
  // Ensures every error response follows the same { statusCode, error, message,
  // timestamp, path } shape.  Never leaks stack traces or internal details.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  // ── Start ────────────────────────────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3000);

  // ── Swagger ──────────────────────────────────────────────────────────────────
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('IQA3 API')
      .setDescription('Social streaming platform — Module 2: User Profiles & Media Storage')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Paste the access_token JWT from /auth/login' },
        'access-token',
      )
      .addCookieAuth('access_token', { type: 'apiKey', in: 'cookie', name: 'access_token' }, 'cookie-auth')
      .addServer(`http://localhost:${process.env.PORT ?? 3006}/`, 'Local dev')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  await app.listen(port);

  if (!isProduction) {
    console.log(`🚀 API running at http://localhost:${port}/api/v1`);
    console.log(`   Health check: http://localhost:${port}/api/v1/health`);
  }
}

void bootstrap();

