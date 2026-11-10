import { config } from './config/environment.js';
import { initDb, driverName, closeDb } from './config/database.js';
import { runMigrations } from './migrate.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

await initDb();
await runMigrations();
const server = createApp().listen(config.port, () =>
  logger.info('Brightlook CRM API listening', { port: config.port, database: driverName(), env: config.env }));

const shutdown = () => server.close(async () => { await closeDb(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
