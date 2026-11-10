import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && !env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');

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
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
  seedAdminPassword: env.SEED_ADMIN_PASSWORD || 'app@123',
};
