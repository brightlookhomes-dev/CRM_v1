import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam, uuid, opt, pageQuery } from '../../validators/common.js';
import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './approvals.service.js';

const listQuery = z.object({
  ...pageQuery,
  status: opt(z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CLARIFICATION_REQUIRED', 'CANCELLED'])),
  type: opt(z.enum(['BILL_REVIEW', 'DECISION_ESCALATION', 'ADDITIONAL_CHARGE', 'PROJECT', 'OTHER'])),
  projectId: opt(uuid),
});
const body = z.object({
  comment: opt(z.string().trim().max(2000)),
  paymentMode: opt(z.enum(['CASH', 'UPI', 'CHEQUE', 'NET_BANKING', 'NEFT', 'RTGS', 'IMPS', 'OTHER'])),
  paymentReference: opt(z.string().trim().min(2).max(100)),
});
const action = (name, message) => [validate({ params: idParam, body }),
  asyncHandler(async (req, res) => send(res, message, await service.act(req.ctx, req.valid.params.id, name, req.valid.body.comment, req.valid.body)))];

const router = Router();
router.use(authenticate, authorize('ADMIN'));
router.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const { data, meta } = await service.listApprovals(req.valid.query);
  send(res, 'Approvals retrieved', data, meta);
}));
router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => send(res, 'Approval retrieved', await service.getApproval(req.valid.params.id))));
router.post('/:id/approve', ...action('APPROVE', 'Approved'));
router.post('/:id/reject', ...action('REJECT', 'Rejected'));
router.post('/:id/request-clarification', ...action('CLARIFY', 'Clarification requested'));
export default router;
