import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const storageProvider = env.STORAGE_PROVIDER || 'local';
const cookieSameSite = env.COOKIE_SAME_SITE || 'lax';

if (isProd && !env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
if (!['local', 'r2'].includes(storageProvider)) throw new Error('STORAGE_PROVIDER must be "local" or "r2"');
if (!['lax', 'strict', 'none'].includes(cookieSameSite)) throw new Error('COOKIE_SAME_SITE must be "lax", "strict", or "none"');
if (storageProvider === 'r2' && (!env.R2_ACCOUNT_ID || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)) {
  throw new Error('R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required when STORAGE_PROVIDER=r2');
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 4000),
  // If DATABASE_URL is set we use PostgreSQL via pg. Otherwise an embedded Postgres (PGlite) is used.
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: env.PGLITE_DIR || './data/pgdata', // use "memory" for an ephemeral DB
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  accessTtl: env.ACCESS_TOKEN_TTL || '15m',
  refreshTtlDays: Number(env.REFRESH_TOKEN_DAYS || 7),
  refreshTtlRememberDays: Number(env.REFRESH_TOKEN_REMEMBER_DAYS || 30),
  corsOrigin: (env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  uploadDir: env.UPLOAD_DIR || './uploads',
  storageProvider,
  cookieSameSite,
  r2AccountId: env.R2_ACCOUNT_ID || '',
  r2Bucket: env.R2_BUCKET || '',
  r2AccessKeyId: env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
  r2Endpoint: env.R2_ENDPOINT || '',
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
  seedAdminPassword: env.SEED_ADMIN_PASSWORD || 'app@123',
};
