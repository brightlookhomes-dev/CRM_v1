import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: '',
      PGLITE_DIR: 'memory',
      UPLOAD_DIR: path.join(os.tmpdir(), 'brightlook-test-uploads'),
      JWT_SECRET: 'test-secret',
      SEED_ADMIN_PASSWORD: 'Admin@12345', // tests are independent of the dev default password
    },
  },
});
