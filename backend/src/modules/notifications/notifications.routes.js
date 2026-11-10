import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam, boolish, opt, pageQuery } from '../../validators/common.js';
import { asyncHandler, send, toCamel, pageMeta, offsetOf } from '../../utils/helpers.js';
import { notFound } from '../../utils/errors.js';

const router = Router();
router.use(authenticate);

router.get('/', validate({ query: z.object({ page: pageQuery.page, limit: pageQuery.limit, unread: opt(boolish) }) }),
  asyncHandler(async (req, res) => {
    const { page, limit, unread } = req.valid.query;
    const cond = unread ? 'and is_read = false' : '';
    const total = (await db.query(`select count(*)::int as n from notifications where recipient_id = $1 ${cond}`, [req.user.id])).rows[0].n;
    const unreadCount = (await db.query('select count(*)::int as n from notifications where recipient_id = $1 and is_read = false', [req.user.id])).rows[0].n;
    const rows = (await db.query(
      `select * from notifications where recipient_id = $1 ${cond} order by created_at desc limit ${limit} offset ${offsetOf(page, limit)}`, [req.user.id])).rows;
    send(res, 'Notifications retrieved', toCamel(rows), { ...pageMeta(page, limit, total), unreadCount });
  }));

// Declared before "/:id/read" so "read-all" is not captured as an id.
router.patch('/read-all', asyncHandler(async (req, res) => {
  await db.query('update notifications set is_read = true where recipient_id = $1 and is_read = false', [req.user.id]);
  send(res, 'All notifications marked as read');
}));

router.patch('/:id/read', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { rows } = await db.query('update notifications set is_read = true where id = $1 and recipient_id = $2 returning *', [req.valid.params.id, req.user.id]);
  if (!rows[0]) throw notFound('Notification');
  send(res, 'Notification marked as read', toCamel(rows[0]));
}));
export default router;
