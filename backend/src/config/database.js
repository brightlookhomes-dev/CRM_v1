import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from './environment.js';

// Uniform driver: { query(text, params) -> {rows}, exec(sql), tx(fn), close() }.
// IMPORTANT: inside withTx always use the provided `tx` handle, never the global `db`.
let driver;

const toNumber = (v) => (v === null ? null : Number(v));
const keepString = (v) => v;
const PARSERS = { 1700: toNumber, 20: toNumber, 1082: keepString }; // numeric, int8, date

export async function initDb() {
  if (driver) return driver;
  if (config.databaseUrl) {
    for (const [oid, fn] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), fn);
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    driver = {
      name: 'postgres',
      query: (text, params) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const dir = config.pgliteDir === 'memory' ? undefined : config.pgliteDir;
    if (dir) fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
    const lite = new PGlite(dir);
    await lite.waitReady;
    const opts = { parsers: PARSERS }; // PGlite only honours parsers when given per query
    driver = {
      name: 'pglite',
      query: (text, params) => lite.query(text, params, opts),
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((t) => fn({ query: (text, params) => t.query(text, params, opts) })),
      close: () => lite.close(),
    };
  }
  return driver;
}

export const db = { query: (text, params = []) => driver.query(text, params) };
export const withTx = (fn) => driver.tx(fn);
export const execSql = (sql) => driver.exec(sql);
export const closeDb = async () => {
  if (driver) await driver.close();
  driver = undefined;
};
export const driverName = () => driver?.name;
