import { validateEnvironment } from './env.validation';

const VALID_BASE: Record<string, string> = {
  JWT_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  CLIENT_URL: 'https://example.com',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
};

describe('validateEnvironment', () => {
  describe('required keys', () => {
    it('passes with all required keys present', () => {
      expect(() => validateEnvironment(VALID_BASE)).not.toThrow();
    });

    it.each(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'CLIENT_URL', 'DATABASE_URL'])(
      'throws when %s is missing',
      (key) => {
        const env = { ...VALID_BASE };
        delete env[key];
        expect(() => validateEnvironment(env)).toThrow(key);
      },
    );

    it('throws when a required key is an empty string', () => {
      const env = { ...VALID_BASE, JWT_SECRET: '' };
      expect(() => validateEnvironment(env)).toThrow('JWT_SECRET');
    });

    it('throws when a required key is whitespace only', () => {
      const env = { ...VALID_BASE, DATABASE_URL: '   ' };
      expect(() => validateEnvironment(env)).toThrow('DATABASE_URL');
    });
  });

  describe('JWT secret strength', () => {
    it('throws when JWT_SECRET is shorter than 64 characters', () => {
      const env = { ...VALID_BASE, JWT_SECRET: 'short' };
      expect(() => validateEnvironment(env)).toThrow('JWT_SECRET must be at least 64');
    });

    it('throws when JWT_REFRESH_SECRET is shorter than 64 characters', () => {
      const env = { ...VALID_BASE, JWT_REFRESH_SECRET: 'short' };
      expect(() => validateEnvironment(env)).toThrow('JWT_REFRESH_SECRET must be at least 64');
    });

    it('accepts secrets exactly 64 characters long', () => {
      const env = { ...VALID_BASE, JWT_SECRET: 'x'.repeat(64), JWT_REFRESH_SECRET: 'y'.repeat(64) };
      expect(() => validateEnvironment(env)).not.toThrow();
    });
  });

  describe('boolean keys', () => {
    it('accepts AUTH_COOKIE_SECURE=true', () => {
      expect(() => validateEnvironment({ ...VALID_BASE, AUTH_COOKIE_SECURE: 'true' })).not.toThrow();
    });

    it('accepts AUTH_COOKIE_SECURE=false', () => {
      expect(() => validateEnvironment({ ...VALID_BASE, AUTH_COOKIE_SECURE: 'false' })).not.toThrow();
    });

    it('throws when AUTH_COOKIE_SECURE has an invalid value', () => {
      const env = { ...VALID_BASE, AUTH_COOKIE_SECURE: 'yes' };
      expect(() => validateEnvironment(env)).toThrow('AUTH_COOKIE_SECURE');
    });

    it('does not throw when AUTH_COOKIE_SECURE is absent', () => {
      expect(() => validateEnvironment({ ...VALID_BASE })).not.toThrow();
    });
  });

  describe('number keys', () => {
    it('accepts a valid PORT number', () => {
      expect(() => validateEnvironment({ ...VALID_BASE, PORT: '3006' })).not.toThrow();
    });

    it('throws when PORT is not a number', () => {
      expect(() => validateEnvironment({ ...VALID_BASE, PORT: 'abc' })).toThrow('PORT');
    });

    it('accepts a valid MAIL_PORT number', () => {
      expect(() => validateEnvironment({ ...VALID_BASE, MAIL_PORT: '587' })).not.toThrow();
    });

    it('throws when MAIL_PORT is not a number', () => {
      expect(() => validateEnvironment({ ...VALID_BASE, MAIL_PORT: 'smtp' })).toThrow('MAIL_PORT');
    });
  });

  describe('URL keys', () => {
    it('throws when CLIENT_URL is not a valid URL', () => {
      const env = { ...VALID_BASE, CLIENT_URL: 'not-a-url' };
      expect(() => validateEnvironment(env)).toThrow('CLIENT_URL');
    });

    it('accepts a valid https CLIENT_URL', () => {
      const env = { ...VALID_BASE, CLIENT_URL: 'https://app.example.com' };
      expect(() => validateEnvironment(env)).not.toThrow();
    });

    it('throws when API_URL is present but not a valid URL', () => {
      const env = { ...VALID_BASE, API_URL: 'ftp://invalid' };
      expect(() => validateEnvironment(env)).toThrow('API_URL');
    });

    it('does not throw when optional URL keys are absent', () => {
      expect(() => validateEnvironment({ ...VALID_BASE })).not.toThrow();
    });
  });

  describe('NODE_ENV', () => {
    const VALID_PROD_BASE = {
      ...VALID_BASE,
      DATABASE_URL: 'postgresql://user:pass@host:5432/db?sslmode=require',
      STRIPE_SECRET_KEY: 'sk_live_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
    };

    it.each(['development', 'test', 'staging'])(
      'accepts NODE_ENV=%s',
      (value) => {
        expect(() => validateEnvironment({ ...VALID_BASE, NODE_ENV: value })).not.toThrow();
      },
    );

    it('accepts NODE_ENV=production with all production requirements met', () => {
      expect(() => validateEnvironment({ ...VALID_PROD_BASE, NODE_ENV: 'production' })).not.toThrow();
    });

    it('throws for an unknown NODE_ENV value', () => {
      const env = { ...VALID_BASE, NODE_ENV: 'unknown' };
      expect(() => validateEnvironment(env)).toThrow('NODE_ENV');
    });
  });

  describe('DATABASE_URL SSL in production', () => {
    it('throws in production when DATABASE_URL lacks sslmode', () => {
      const env = {
        ...VALID_BASE,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };
      expect(() => validateEnvironment(env)).toThrow('sslmode=require');
    });

    it('passes in production when DATABASE_URL includes sslmode=require', () => {
      const env = {
        ...VALID_BASE,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@host:5432/db?sslmode=require',
        STRIPE_SECRET_KEY: 'sk_live_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
      };
      expect(() => validateEnvironment(env)).not.toThrow();
    });

    it('does not require SSL outside production', () => {
      const env = { ...VALID_BASE, NODE_ENV: 'development' };
      expect(() => validateEnvironment(env)).not.toThrow();
    });
  });

  describe('STORAGE_PROVIDER', () => {
    it('accepts STORAGE_PROVIDER=local', () => {
      expect(() => validateEnvironment({ ...VALID_BASE, STORAGE_PROVIDER: 'local' })).not.toThrow();
    });

    it('accepts STORAGE_PROVIDER=s3 with all required S3 keys', () => {
      const env = {
        ...VALID_BASE,
        STORAGE_PROVIDER: 's3',
        AWS_S3_BUCKET: 'my-bucket',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI',
      };
      expect(() => validateEnvironment(env)).not.toThrow();
    });

    it('throws for an invalid STORAGE_PROVIDER value', () => {
      const env = { ...VALID_BASE, STORAGE_PROVIDER: 'gcs' };
      expect(() => validateEnvironment(env)).toThrow('STORAGE_PROVIDER');
    });

    it('throws when STORAGE_PROVIDER=s3 but S3 keys are missing', () => {
      const env = { ...VALID_BASE, STORAGE_PROVIDER: 's3' };
      expect(() => validateEnvironment(env)).toThrow('AWS_S3_BUCKET');
    });
  });

  describe('Stripe keys in production', () => {
    const prodBase = {
      ...VALID_BASE,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@host:5432/db?sslmode=require',
    };

    it('throws when STRIPE_SECRET_KEY is missing in production', () => {
      const env = { ...prodBase, STRIPE_WEBHOOK_SECRET: 'whsec_test' };
      expect(() => validateEnvironment(env)).toThrow('STRIPE_SECRET_KEY');
    });

    it('throws when STRIPE_WEBHOOK_SECRET is missing in production', () => {
      const env = { ...prodBase, STRIPE_SECRET_KEY: 'sk_live_test' };
      expect(() => validateEnvironment(env)).toThrow('STRIPE_WEBHOOK_SECRET');
    });

    it('passes when both Stripe keys are present in production', () => {
      const env = {
        ...prodBase,
        STRIPE_SECRET_KEY: 'sk_live_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
      };
      expect(() => validateEnvironment(env)).not.toThrow();
    });

    it('does not require Stripe keys outside production', () => {
      const env = { ...VALID_BASE, NODE_ENV: 'development' };
      expect(() => validateEnvironment(env)).not.toThrow();
    });
  });

  describe('return value', () => {
    it('returns the config object unchanged when valid', () => {
      const env = { ...VALID_BASE };
      expect(validateEnvironment(env)).toBe(env);
    });
  });
});
