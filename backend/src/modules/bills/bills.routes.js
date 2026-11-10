import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate, uploadFields } from '../../middleware/common.js';
import { idParam, uuid, dateStr, money, opt, pageQuery } from '../../validators/common.js';
import { BILL_CATEGORIES } from '../../constants/billCategories.js';
import * as c from './bills.controller.js';

const text = (max) => opt(z.string().trim().max(max));
const STATUSES = ['DRAFT', 'PENDING_ADMIN_REVIEW', 'CLARIFICATION_REQUIRED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'];

const createBody = z.object({
  projectId: uuid,
  vendorName: z.string().trim().min(2, 'Vendor is required').max(200),
  invoiceNumber: z.string().trim().min(1, 'Invoice number is required').max(100),
  category: z.enum(BILL_CATEGORIES, { errorMap: () => ({ message: 'Select a category' }) }),
  amount: money,
  taxAmount: opt(z.coerce.number().min(0)),
  billDate: dateStr,
  dueDate: opt(dateStr),
  description: text(2000),
}).refine((b) => !b.dueDate || b.dueDate >= b.billDate, { message: 'Due date cannot be before bill date', path: ['dueDate'] });

const editBody = z.object({
  vendorName: z.string().trim().min(2).max(200).optional(),
  invoiceNumber: z.string().trim().min(1).max(100).optional(),
  category: z.enum(BILL_CATEGORIES).optional(),
  amount: money.optional(), taxAmount: z.coerce.number().min(0).optional(),
  billDate: dateStr.optional(), dueDate: dateStr.optional(), description: z.string().trim().max(2000).optional(),
});
const listQuery = z.object({
  ...pageQuery, projectId: opt(uuid), pmId: opt(uuid), vendor: text(100), status: opt(z.enum(STATUSES)),
  dateFrom: opt(dateStr), dateTo: opt(dateStr), minAmount: opt(z.coerce.number()), maxAmount: opt(z.coerce.number()),
});
export const PAYMENT_MODES = ['CASH', 'UPI', 'CHEQUE', 'NET_BANKING', 'NEFT', 'RTGS', 'IMPS', 'OTHER'];
const comment = z.object({
  comment: opt(z.string().trim().max(2000)),
  paymentMode: opt(z.enum(PAYMENT_MODES)),
  paymentReference: opt(z.string().trim().min(2).max(100)),
});

const router = Router();
router.use(authenticate, authorize('ADMIN', 'PROJECT_MANAGER'));
router.post('/', authorize('PROJECT_MANAGER'), uploadFields([{ name: 'file', maxCount: 1 }, { name: 'attachments', maxCount: 5 }]), validate({ body: createBody }), c.create);
router.get('/', validate({ query: listQuery }), c.list);
router.get('/:id', validate({ params: idParam }), c.get);
router.get('/:id/history', validate({ params: idParam }), c.history);
router.patch('/:id', authorize('PROJECT_MANAGER'), validate({ params: idParam, body: editBody }), c.edit);
router.post('/:id/resubmit', authorize('PROJECT_MANAGER'), uploadFields([{ name: 'file', maxCount: 1 }, { name: 'attachments', maxCount: 5 }]),
  validate({ params: idParam, body: z.object({ note: z.string().trim().min(2, 'Add a response note').max(2000), amount: opt(money) }) }), c.resubmit);
router.post('/:id/approve', authorize('ADMIN'), validate({ params: idParam, body: comment }), c.review('APPROVE', 'Bill approved'));
router.post('/:id/reject', authorize('ADMIN'), validate({ params: idParam, body: comment }), c.review('REJECT', 'Bill rejected'));
router.post('/:id/request-clarification', authorize('ADMIN'), validate({ params: idParam, body: comment }), c.review('REQUEST_CLARIFICATION', 'Clarification requested'));
router.post('/:id/mark-paid', authorize('ADMIN'),
  validate({ params: idParam, body: z.object({ paymentReference: opt(z.string().trim().min(1).max(100)), paidDate: opt(dateStr) }) }), c.markPaid);
export default router;
