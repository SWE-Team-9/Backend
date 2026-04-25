type Env = Record<string, string | undefined>;

// Always required — the server cannot function without these.
const REQUIRED_ENV_KEYS = ["JWT_SECRET", "CLIENT_URL", "DATABASE_URL"] as const;

// Optional keys that, when present, must pass a format check.
const BOOLEAN_KEYS = ["AUTH_COOKIE_SECURE"] as const;
const NUMBER_KEYS = ["PORT", "MAIL_PORT"] as const;
const URL_KEYS = [
  "CLIENT_URL",
  "API_URL",
  "GOOGLE_CALLBACK_URL",
  "CDN_URL",
] as const;

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateEnvironment(config: Env): Env {
  const errors: string[] = [];

  // ── Required keys ──────────────────────────────────────────────────────────
  for (const key of REQUIRED_ENV_KEYS) {
    if (!config[key] || config[key]!.trim() === "") {
      errors.push(`${key} is required but was not set.`);
    }
  }

  // ── Boolean keys ───────────────────────────────────────────────────────────
  for (const key of BOOLEAN_KEYS) {
    const value = config[key];
    if (value !== undefined && !["true", "false"].includes(value)) {
      errors.push(`${key} must be "true" or "false" (got "${value}").`);
    }
  }

  // ── Number keys ────────────────────────────────────────────────────────────
  for (const key of NUMBER_KEYS) {
    const value = config[key];
    if (value !== undefined && Number.isNaN(Number(value))) {
      errors.push(`${key} must be a valid number (got "${value}").`);
    }
  }

  // ── URL keys ───────────────────────────────────────────────────────────────
  for (const key of URL_KEYS) {
    const value = config[key];
    if (value !== undefined && value.trim() !== "" && !isValidUrl(value)) {
      errors.push(`${key} must be a valid http/https URL (got "${value}").`);
    }
  }

  // ── JWT_SECRET strength ────────────────────────────────────────────────────
  const jwtSecret = config["JWT_SECRET"];
  if (jwtSecret && jwtSecret.length < 32) {
    errors.push(
      `JWT_SECRET must be at least 32 characters long for security (got ${jwtSecret.length} chars).`,
    );
  }

  // ── NODE_ENV ───────────────────────────────────────────────────────────────
  const nodeEnv = config["NODE_ENV"];
  if (
    nodeEnv !== undefined &&
    !["development", "test", "production", "staging"].includes(nodeEnv)
  ) {
    errors.push(
      `NODE_ENV must be one of: development, test, production, staging (got "${nodeEnv}").`,
    );
  }

  // ── STORAGE_PROVIDER ───────────────────────────────────────────────────────
  const storageProvider = config["STORAGE_PROVIDER"];
  if (
    storageProvider !== undefined &&
    !["local", "s3"].includes(storageProvider)
  ) {
    errors.push(
      `STORAGE_PROVIDER must be "local" or "s3" (got "${storageProvider}").`,
    );
  }

  // ── S3 — require bucket credentials when provider is s3 ───────────────────
  if (storageProvider === "s3") {
    const s3Keys = [
      "AWS_S3_BUCKET",
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
    ];
    for (const key of s3Keys) {
      if (!config[key] || config[key]!.trim() === "") {
        errors.push(`${key} is required when STORAGE_PROVIDER=s3.`);
      }
    }
  }

  // ── Fail fast ──────────────────────────────────────────────────────────────
  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n  • ${errors.join("\n  • ")}`,
    );
  }

  return config;
}
