import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, db, execSql, closeDb } from './config/database.js';
import { logger } from './utils/logger.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function runMigrations() {
  await initDb();
  await execSql('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const { rows } = await db.query('select name from schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    await execSql(`begin;\n${sql}\ninsert into schema_migrations(name) values ('${file}');\ncommit;`);
    logger.info('migration applied', { file });
    ran.push(file);
  }
  return ran;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((ran) => logger.info('migrations complete', { applied: ran.length }))
    .catch((err) => { logger.error('migration failed', { error: err.message }); process.exitCode = 1; })
    .finally(closeDb);
}
