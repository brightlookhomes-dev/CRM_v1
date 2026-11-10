import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate, uploadFields } from '../../middleware/common.js';
import { idParam, uuid, opt, boolish, jsonArray, pageQuery } from '../../validators/common.js';
import * as c from './decisions.controller.js';

export const optionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  description: opt(z.string().trim().max(1000)),
  priceNote: opt(z.string().trim().max(200)),
  additionalCharge: opt(z.coerce.number().min(0)),
});

export const decisionFields = {
  title: z.string().trim().min(3).max(200),
  description: opt(z.string().trim().max(5000)),
  category: opt(z.string().trim().max(100)),
  details: opt(z.string().trim().max(5000)),
  deadline: opt(z.string().datetime({ offset: true })),
  requiresAdminApproval: opt(boolish),
  options: jsonArray(optionSchema).pipe(z.array(optionSchema).min(2, 'Provide at least two options').max(10)),
};

// Mounted at /projects/:id/decisions
export const nested = Router({ mergeParams: true });
nested.use(authenticate);
nested.post('/', authorize('ADMIN', 'PROJECT_MANAGER'), uploadFields([{ name: 'photos', maxCount: 4 }]),
  validate({ params: idParam, body: z.object(decisionFields) }), c.create);
nested.get('/', validate({ params: idParam, query: z.object({ ...pageQuery, status: opt(z.string()) }) }), c.list);

// Mounted at /decisions
const router = Router();
router.use(authenticate);
router.get('/:id', validate({ params: idParam }), c.get);
router.get('/:id/history', validate({ params: idParam }), c.history);
router.post('/:id/respond', authorize('CUSTOMER'), uploadFields([{ name: 'documents', maxCount: 4 }]),
  validate({ params: idParam, body: z.object({ optionId: uuid, comment: opt(z.string().trim().max(2000)) }) }), c.respond);
router.post('/:id/finalize', authorize('ADMIN', 'PROJECT_MANAGER'),
  validate({ params: idParam, body: z.object({ action: z.enum(['APPROVE', 'REJECT', 'REOPEN']), comment: opt(z.string().trim().max(2000)) }) }), c.finalize);
router.post('/:id/cancel', authorize('ADMIN', 'PROJECT_MANAGER'),
  validate({ params: idParam, body: z.object({ comment: opt(z.string().trim().max(2000)) }) }), c.cancel);
export default router;
