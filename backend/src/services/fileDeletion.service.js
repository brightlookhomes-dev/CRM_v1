import { db } from '../config/database.js';
import { storage } from './fileStorage.service.js';
import { logger } from '../utils/logger.js';

let processing;

export async function enqueueFileDeletions(tx, files) {
  for (const file of files) {
    await tx.query(
      `insert into file_deletion_jobs (storage_provider, relative_path)
       values ($1,$2) on conflict (storage_provider, relative_path) do nothing`,
      [file.storage_provider, file.relative_path],
    );
  }
}

async function processBatch(limit) {
  const { rows } = await db.query(
    'select id, storage_provider, relative_path, attempts from file_deletion_jobs where next_attempt_at <= now() order by id limit $1',
    [limit],
  );
  let failed = 0;

  for (const job of rows) {
    try {
      await storage.remove(job.storage_provider, job.relative_path);
      await db.query('delete from file_deletion_jobs where id = $1', [job.id]);
    } catch (error) {
      failed += 1;
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(job.attempts, 7)));
      await db.query(
        `update file_deletion_jobs
         set attempts = attempts + 1, next_attempt_at = now() + ($2 * interval '1 second'), last_error = $3
         where id = $1`,
        [job.id, delaySeconds, String(error?.message || error).slice(0, 1000)],
      );
      logger.warn('media deletion deferred for retry', {
        jobId: job.id,
        storageProvider: job.storage_provider,
        attempts: job.attempts + 1,
      });
    }
  }

  return { attempted: rows.length, failed };
}

export function processFileDeletions(limit = 25) {
  if (processing) return processing;
  processing = processBatch(limit).finally(() => { processing = null; });
  return processing;
}
