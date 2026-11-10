import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config/environment.js';
import { AppError } from '../utils/errors.js';

/** Storage adapter contract: put / stream / remove. Swap for S3/Azure without touching callers. */
class LocalStorageAdapter {
  constructor(root) { this.root = path.resolve(root); }

  resolve(rel) {
    const full = path.resolve(this.root, rel);
    if (!full.startsWith(this.root + path.sep)) throw new AppError(400, 'Invalid file path');
    return full;
  }

  async put(rel, buffer) {
    const full = this.resolve(rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer, { flag: 'wx' });
  }

  stream(rel) { return createReadStream(this.resolve(rel)); }

  async remove(rel) { await fs.rm(this.resolve(rel), { force: true }); }
}

export const storage = new LocalStorageAdapter(config.uploadDir);

const CATEGORIES = new Set(['projects', 'project-updates', 'vendor-bills', 'decisions', 'payments', 'profiles']);
// Allowed by *detected* content (magic bytes), not by client-supplied extension/MIME.
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export async function saveUploadedFile(exec, file, { category, uploadedBy, projectId = null, visibility = 'PROJECT' }) {
  if (!CATEGORIES.has(category)) throw new AppError(500, 'Invalid storage category');
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !ALLOWED[detected.mime]) {
    throw new AppError(400, `"${file.originalname}" is not an allowed file type (JPEG, PNG, WebP or PDF)`);
  }
  const ext = ALLOWED[detected.mime];
  const storedName = `${crypto.randomUUID()}.${ext}`;
  const now = new Date();
  const relativePath = `${category}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${storedName}`;
  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
  await storage.put(relativePath, file.buffer);
  try {
    const { rows } = await exec.query(
      `insert into files (original_name, stored_name, relative_path, mime_type, file_extension, file_size,
         storage_provider, checksum, project_id, visibility, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,'local',$7,$8,$9,$10) returning *`,
      [path.basename(file.originalname).slice(0, 255), storedName, relativePath, detected.mime, ext,
        file.size, checksum, projectId, visibility, uploadedBy],
    );
    return rows[0];
  } catch (err) {
    await storage.remove(relativePath);
    throw err;
  }
}

export async function saveMany(exec, files = [], opts) {
  const saved = [];
  for (const f of files) saved.push(await saveUploadedFile(exec, f, opts)); // sequential: one tx connection
  return saved;
}
