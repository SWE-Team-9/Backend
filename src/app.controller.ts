import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "./common/decorators/public.decorator";

@ApiTags("Health")
@Controller()
export class AppController {
  @Public()
  @ApiOperation({
    summary: "Health check",
    description: "Returns server status and timestamp.",
  })
  @ApiResponse({
    status: 200,
    description: '{ status: "ok", timestamp: string }',
  })
  @Get("health")
  getHealth() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("env")
  getEnv() {
    const exampleEnv = `# Server
PORT=3006
NODE_ENV=development
CLIENT_URL=https://iqa3.tech

FRONTEND_URL=https://iqa3.tech
# Swagger Fix!
SWAGGER_ENABLED=true

# CORS — Allowing your EC2 frontend to talk to the backend
ALLOWED_ORIGINS=https://iqa3.tech,http://13.53.103.19

# PostgreSQL Database
DB_USER=postgres
DB_PASSWORD=7HTlhmrvwzxc1KykqMK2
DB_HOST=iqa3-db.cj60kgqq054t.eu-north-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=postgres
DATABASE_URL=postgresql://\${DB_USER}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_NAME}?schema=public

# JWT Security
JWT_SECRET=super_secure_jwt_secret_key_minimum_32_characters_long
JWT_REFRESH_SECRET=super_secure_jwt_refresh_secret_key_minimum_32_chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Google OAuth 2.0 (Optional for development)
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_CALLBACK_URL=https://iqa3.tech/api/v1/auth/google/callback

# Auth Cookie Security
AUTH_COOKIE_SECURE=false

# Email (SMTP) — code reads MAIL_* not SMTP_*
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=Mohannadehab10@gmail.com
MAIL_PASS=fgnc bvmy egun wrme
MAIL_FROM=Mohannadehab10@gmail.com

# Google reCAPTCHA standard (used by main web frontend only)
RECAPTCHA_SECRET=6LdfQZksAAAAAOs3kcGOYAoJCZZTabNgI0kVRkyn
# reCAPTCHA Enterprise — Android (recaptcha_enterprise_flutter SDK)
# and Windows (WebView loading Enterprise JS via grecaptcha.enterprise.execute)
# Enterprise Project
RECAPTCHA_ENTERPRISE_API_KEY=AIzaSyAyEi66euoTPhj2m6dNIBPxvhdMQVgr5Vw
RECAPTCHA_ENTERPRISE_PROJECT_ID=soundcloud-490822
RECAPTCHA_ENTERPRISE_ANDROID_SITE_KEY=6LcPd5EsAAAAAO8YOCSJJJr3PmX_lBzPaF-SvxR7
RECAPTCHA_ENTERPRISE_WEB_SITE_KEY=your_enterprise_web_site_key_here
CAPTCHA_ENABLED=false

# Stripe (Optional)
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STORAGE_PROVIDER=s3
# AWS S3 (Optional)
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key_here
AWS_S3_BUCKET=iqa3-media-storage

# Firebase (Optional)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_client_email
FIREBASE_PRIVATE_KEY=your_private_key

# File Uploads
UPLOAD_DIR=uploads
MAX_FILE_SIZE=52428800`;

    const envVarNames = exampleEnv
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]);

    const envVars = envVarNames.reduce(
      (acc, varName) => {
        acc[varName] = process.env[varName]
          ? process.env[varName]
          : "undefined";
        return acc;
      },
      {} as Record<string, string>,
    );

    return {
      ...envVars,
    };
  }
}
