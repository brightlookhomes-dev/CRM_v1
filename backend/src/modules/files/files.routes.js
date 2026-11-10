import { Router } from 'express';
import { db } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam } from '../../validators/common.js';
import { asyncHandler } from '../../utils/helpers.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { storage } from '../../services/fileStorage.service.js';

const router = Router();
router.use(authenticate);

/** Authenticated file access: admin, uploader, or a user assigned to the file's project (customers: PROJECT visibility only). */
async function canAccess(user, file) {
  if (user.role === 'ADMIN' || file.uploaded_by === user.id) return true;
  if (!file.project_id) return false;
  if (user.role === 'CUSTOMER' && file.visibility !== 'PROJECT') return false;
  const { rows } = await db.query(
    'select 1 from project_assignments where project_id = $1 and user_id = $2 and assignment_role = $3 and is_active',
    [file.project_id, user.id, user.role]);
  return rows.length > 0;
}

router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const file = (await db.query('select * from files where id = $1', [req.valid.params.id])).rows[0];
  if (!file) throw notFound('File');
  if (!(await canAccess(req.user, file))) throw forbidden('You do not have access to this file');
  const body = await storage.stream(file.storage_provider, file.relative_path);
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Length', String(file.file_size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  const safeName = encodeURIComponent(file.original_name);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${safeName}`);
  body.on('error', () => res.destroy()).pipe(res);
}));
export default router;
