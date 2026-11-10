import { config } from './config/environment.js';
import { initDb, driverName, closeDb } from './config/database.js';
import { runMigrations } from './migrate.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { processFileDeletions } from './services/fileDeletion.service.js';

await initDb();
await runMigrations();
await processFileDeletions();
const cleanupTimer = setInterval(() => {
  processFileDeletions().catch((err) => logger.error('media deletion retry failed', { error: err.message }));
}, 60_000);
cleanupTimer.unref();
const server = createApp().listen(config.port, '0.0.0.0', () =>
  logger.info('Brightlook CRM API listening', { port: config.port, database: driverName(), env: config.env }));

const shutdown = () => server.close(async () => { clearInterval(cleanupTimer); await closeDb(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
