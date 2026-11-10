import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate, uploadFields } from '../../middleware/common.js';
import { idParam, uuid, dateStr, money, opt, pageQuery } from '../../validators/common.js';
import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './payments.service.js';

const METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER'];
const recordBody = z.object({
  entryType: opt(z.enum(['PAYMENT', 'REFUND'])),
  paymentType: opt(z.enum(['ADVANCE', 'MILESTONE', 'INSTALLMENT', 'PARTIAL', 'FINAL'])),
  amount: money,
  paymentMethod: z.enum(METHODS),
  paymentDate: dateStr.refine((d) => d <= new Date().toISOString().slice(0, 10), 'Payment date cannot be in the future'),
  referenceNumber: z.string().trim().min(2, 'Transaction/reference number is required').max(100),
  notes: opt(z.string().trim().max(1000)),
  invoiceDescription: opt(z.string().trim().max(300)),
}).refine((b) => b.entryType === 'REFUND' || b.paymentType, { message: 'Payment type is required', path: ['paymentType'] });

// Mounted at /projects/:id/payments
export const nested = Router({ mergeParams: true });
nested.use(authenticate);
nested.post('/', authorize('ADMIN'), uploadFields([{ name: 'receipt', maxCount: 1 }]), validate({ params: idParam, body: recordBody }),
  asyncHandler(async (req, res) => send(res, 'Payment recorded', await service.recordPayment(req.ctx, req.valid.params.id, req.valid.body, req.files?.receipt?.[0]), undefined, 201)));
nested.get('/', authorize('ADMIN', 'CUSTOMER'), validate({ params: idParam, query: z.object({ page: pageQuery.page, limit: pageQuery.limit }) }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await service.listForProject(req.user, req.valid.params.id, req.valid.query);
    send(res, 'Payments retrieved', data, meta);
  }));

// Mounted at /payments
const router = Router();
router.use(authenticate);
router.get('/', authorize('ADMIN'), validate({ query: z.object({ ...pageQuery, projectId: opt(uuid), method: opt(z.enum(METHODS)), entryType: opt(z.enum(['PAYMENT', 'REFUND', 'REVERSAL'])), dateFrom: opt(dateStr), dateTo: opt(dateStr) }) }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await service.listAll(req.valid.query);
    send(res, 'Payments retrieved', data, meta);
  }));
router.get('/:id', authorize('ADMIN', 'CUSTOMER'), validate({ params: idParam }), asyncHandler(async (req, res) => send(res, 'Payment retrieved', await service.getPayment(req.user, req.valid.params.id))));
router.get('/:id/invoice', authorize('ADMIN', 'CUSTOMER'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { buffer, invoiceNumber } = await service.getInvoiceDocx(req.user, req.valid.params.id);
  const name = `Tax Invoice ${invoiceNumber.replace(/\//g, '-')}.docx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`); // invoices are always delivered as Word files
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(buffer);
}));
export default router;
