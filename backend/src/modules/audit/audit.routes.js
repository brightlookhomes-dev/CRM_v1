import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam, uuid, dateStr, opt, pageQuery } from '../../validators/common.js';
import { asyncHandler, send, toCamel, pageMeta, offsetOf, whereBuilder } from '../../utils/helpers.js';
import { notFound } from '../../utils/errors.js';

const listQuery = z.object({
  ...pageQuery, userId: opt(uuid), projectId: opt(uuid), action: opt(z.string().max(80)), module: opt(z.string().max(40)),
  entityType: opt(z.string().max(60)), entityId: opt(uuid), from: opt(dateStr), to: opt(dateStr),
});

const SELECT = `select a.*, u.full_name as actor_name, p.name as project_name
  from audit_logs a left join users u on u.id = a.actor_user_id left join projects p on p.id = a.project_id`;

const router = Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const { page, limit, q, userId, projectId, action, module, entityType, entityId, from, to } = req.valid.query;
  const w = whereBuilder();
  if (userId) w.and(`a.actor_user_id = ${w.p(userId)}`);
  if (projectId) w.and(`a.project_id = ${w.p(projectId)}`);
  if (action) w.and(`a.action_type = ${w.p(action)}`);
  if (module) w.and(`a.module = ${w.p(module)}`);
  if (entityType) w.and(`a.entity_type = ${w.p(entityType)}`);
  if (entityId) w.and(`a.entity_id = ${w.p(entityId)}`);
  if (from) w.and(`a.created_at >= ${w.p(from)}::date`);
  if (to) w.and(`a.created_at < (${w.p(to)}::date + 1)`);
  if (q) w.and(`a.description ilike ${w.p(`%${q}%`)}`);
  const total = (await db.query(`select count(*)::int as n from audit_logs a ${w.clause}`, w.params)).rows[0].n;
  const rows = (await db.query(`${SELECT} ${w.clause} order by a.created_at desc, a.id limit ${limit} offset ${offsetOf(page, limit)}`, w.params)).rows;
  send(res, 'Audit logs retrieved', toCamel(rows), pageMeta(page, limit, total));
}));

router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const row = (await db.query(`${SELECT} where a.id = $1`, [req.valid.params.id])).rows[0];
  if (!row) throw notFound('Audit log');
  send(res, 'Audit log retrieved', toCamel(row));
}));
export default router;
