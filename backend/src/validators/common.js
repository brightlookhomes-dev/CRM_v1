import { z } from 'zod';

export const uuid = z.string().uuid();
export const idParam = z.object({ id: uuid });
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const money = z.coerce.number().positive('Must be greater than 0').max(999_999_999_999);

// Multipart forms send "" for empty fields: treat as undefined.
export const opt = (schema) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

export const boolish = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean());

// Arrays arrive as JSON strings in multipart bodies.
export const jsonArray = (inner) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
  }, z.array(inner));

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: opt(z.string().trim().max(100)),
};
