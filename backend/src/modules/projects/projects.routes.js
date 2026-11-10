import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate, uploadFields } from '../../middleware/common.js';
import { idParam, uuid, dateStr, opt, jsonArray, pageQuery } from '../../validators/common.js';
import * as c from './projects.controller.js';
import { nested as updatesRouter } from '../updates/updates.routes.js';
import { nested as decisionsRouter } from '../decisions/decisions.routes.js';
import { nested as paymentsRouter } from '../payments/payments.routes.js';
import ledgerRouter from '../ledger/ledger.routes.js';
import { stagesRouter, eventsRouter, stageInput } from '../stages/stages.routes.js';

export const STATUSES = ['PLANNED', 'NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED'];
const status = z.enum(STATUSES);
const amount = z.coerce.number().min(0).max(999_999_999_999);
const progress = z.coerce.number().min(0).max(100);

const fields = {
  name: z.string().trim().min(2).max(200),
  description: opt(z.string().trim().max(5000)),
  location: z.string().trim().min(2).max(200),
  projectType: z.string().trim().min(2).max(100),
  contractAmount: opt(amount),
  startDate: opt(dateStr),
  expectedCompletionDate: opt(dateStr),
  overallProgress: opt(progress),
  status: opt(status),
  projectManagerIds: opt(jsonArray(uuid)),
  customerIds: opt(jsonArray(uuid)),
  stages: opt(jsonArray(stageInput)),
};
const createBody = z.object(fields).refine(
  (b) => !b.startDate || !b.expectedCompletionDate || b.expectedCompletionDate >= b.startDate,
  { message: 'Expected completion cannot be before start date', path: ['expectedCompletionDate'] })
  .refine((b) => !b.stages?.length || b.startDate, { message: 'Set a start date to schedule the construction stages', path: ['startDate'] })
  .refine((b) => !b.stages?.length || Math.abs(b.stages.reduce((a, s) => a + s.weightPercent, 0) - 100) <= 0.01, { message: 'Stage percentages must add up to 100%', path: ['stages'] });
const updateBody = z.object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])));
const listQuery = z.object({
  ...pageQuery,
  status: opt(status), pmId: opt(uuid), customerId: opt(uuid),
  sort: opt(z.enum(['created_at', 'name', 'overall_progress', 'status'])), order: opt(z.enum(['asc', 'desc'])),
});
const assignBody = z.object({ userId: uuid, assignmentRole: z.enum(['PROJECT_MANAGER', 'CUSTOMER']) });

const router = Router();
router.use(authenticate);
router.get('/', validate({ query: listQuery }), c.list);
router.post('/', authorize('ADMIN'), uploadFields([{ name: 'cover', maxCount: 1 }]), validate({ body: createBody }), c.create);
router.get('/:id', validate({ params: idParam }), c.get);
router.patch('/:id', authorize('ADMIN'), uploadFields([{ name: 'cover', maxCount: 1 }]), validate({ params: idParam, body: updateBody }), c.update);
router.delete('/:id', authorize('ADMIN'), validate({ params: idParam }), c.remove);
router.get('/:id/assignments', validate({ params: idParam }), c.getAssignments);
router.post('/:id/assignments', authorize('ADMIN'), validate({ params: idParam, body: assignBody }), c.addAssignment);
router.delete('/:id/assignments/:assignmentId', authorize('ADMIN'),
  validate({ params: z.object({ id: uuid, assignmentId: uuid }) }), c.removeAssignment);

router.use('/:id/updates', updatesRouter);
router.use('/:id/decisions', decisionsRouter);
router.use('/:id/payments', paymentsRouter);
router.use('/:id/ledger', ledgerRouter);
router.use('/:id/stages', stagesRouter);
router.use('/:id/events', eventsRouter);
export default router;
