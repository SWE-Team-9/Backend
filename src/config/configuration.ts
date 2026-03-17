export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 3000),
    clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
    apiUrl: process.env.API_URL ?? "http://localhost:3000/api/v1",
  },
  security: {
    jwtSecret: process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY ?? "15m",
    jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY ?? "7d",
    jwtIssuer: process.env.JWT_ISSUER ?? "spotly-api",
    jwtAudience: process.env.JWT_AUDIENCE ?? "spotly-client",
    recaptchaSecret: process.env.RECAPTCHA_SECRET,
    authCookieSecure: (process.env.AUTH_COOKIE_SECURE ?? "false") === "true",
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  mail: {
    host: process.env.MAIL_HOST ?? "smtp.mailtrap.io",
    port: Number(process.env.MAIL_PORT ?? 2525),
    secure: (process.env.MAIL_SECURE ?? "false") === "true",
    user: process.env.MAIL_USER ?? "",
    pass: process.env.MAIL_PASS ?? "",
    from: process.env.MAIL_FROM ?? "Spotly <noreply@spotly.app>",
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL ??
      "http://localhost:3000/api/v1/auth/google/callback",
  },
  storage: {
    provider: (process.env.STORAGE_PROVIDER ?? "local") as "local" | "s3",
    localUploadDir: process.env.LOCAL_UPLOAD_DIR ?? "./uploads",
    localUploadUrl:
      process.env.LOCAL_UPLOAD_URL ?? "http://localhost:3000/uploads",
    s3Bucket: process.env.AWS_S3_BUCKET ?? "",
    s3Region: process.env.AWS_REGION ?? "us-east-1",
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    cdnUrl: process.env.CDN_URL ?? "",
    maxAvatarBytes: 5 * 1024 * 1024, // 5 MB
    maxCoverBytes: 15 * 1024 * 1024, // 15 MB
  },
});
