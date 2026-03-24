import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Load .env if dotenv is available (local dev). In Docker the env vars are
// injected by the runtime so dotenv is not needed.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv/config');
} catch {
  // dotenv not installed — env vars already provided by the environment
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/placeholder',
  },
});
