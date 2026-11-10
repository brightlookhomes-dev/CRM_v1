import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate, uploadFields } from '../../middleware/common.js';
import { idParam, uuid, dateStr, opt, pageQuery } from '../../validators/common.js';
import { decisionFields } from '../decisions/decisions.routes.js';
import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './updates.service.js';

const TYPES = ['PROGRESS', 'MATERIAL', 'GENERAL', 'APPROVAL_REQUEST'];
const text = (max) => opt(z.string().trim().max(max));

const createBody = z.object({
  type: z.enum(['PROGRESS', 'MATERIAL', 'APPROVAL_REQUEST']), // GENERAL is no longer creatable (legacy rows still display)
  title: text(200),
  description: text(5000),
  progressPercentage: opt(z.coerce.number().min(0).max(100)),
  stageId: opt(uuid),
  workCompleted: text(2000),
  workRemaining: text(2000),
  materialName: text(200),
  quantity: opt(z.coerce.number().positive()),
  unit: text(30),
  supplier: text(200),
  deliveryStatus: opt(z.enum(['ORDERED', 'IN_TRANSIT', 'DELIVERED', 'PARTIAL', 'REJECTED'])),
  deliveryDate: opt(dateStr),
  // approval request (decision) fields
  decisionCategory: text(100),
  details: text(5000),
  deadline: decisionFields.deadline,
  requiresAdminApproval: decisionFields.requiresAdminApproval,
  options: z.any().optional(),
}).superRefine((b, ctx) => {
  const need = (field, msg) => { if (b[field] === undefined) ctx.addIssue({ code: 'custom', path: [field], message: msg }); };
  if (b.type === 'PROGRESS') { need('progressPercentage', 'Progress percentage is required'); need('description', 'Description is required'); }
  if (b.type === 'MATERIAL') { need('materialName', 'Material name is required'); need('quantity', 'Quantity is required'); need('unit', 'Unit is required'); need('deliveryStatus', 'Delivery status is required'); }
  if (b.type === 'GENERAL') need('description', 'Description is required');
  if (b.type === 'APPROVAL_REQUEST') {
    need('title', 'Decision title is required');
    const parsed = decisionFields.options.safeParse(b.options);
    if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['options'], message: parsed.error.issues[0]?.message ?? 'Provide at least two options' });
    else b.options = parsed.data;
  }
}).transform((b) => (b.type === 'MATERIAL' && !b.title ? { ...b, title: `Material: ${b.materialName}` } : b));

const upload = uploadFields([{ name: 'photos', maxCount: 4 }, { name: 'documents', maxCount: 6 }]);

// Mounted at /projects/:id/updates
export const nested = Router({ mergeParams: true });
nested.use(authenticate);
nested.post('/', authorize('ADMIN', 'PROJECT_MANAGER'), upload, validate({ params: idParam, body: createBody }),
  asyncHandler(async (req, res) => send(res, 'Update posted', await service.createUpdate(req.ctx, req.valid.params.id, req.valid.body, req.files), undefined, 201)));
nested.get('/', validate({ params: idParam, query: z.object({ ...pageQuery, type: opt(z.enum(TYPES)) }) }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await service.listUpdates(req.user, req.valid.params.id, req.valid.query);
    send(res, 'Updates retrieved', data, meta);
  }));

// Mounted at /project-updates
const router = Router();
router.use(authenticate);
router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => send(res, 'Update retrieved', await service.getUpdate(req.user, req.valid.params.id))));
router.patch('/:id', authorize('ADMIN', 'PROJECT_MANAGER'),
  validate({ params: idParam, body: z.object({ title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().min(1).max(5000).optional() }) }),
  asyncHandler(async (req, res) => send(res, 'Update modified', await service.editUpdate(req.ctx, req.valid.params.id, req.valid.body))));
export default router;
