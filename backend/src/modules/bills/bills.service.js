import { db, withTx } from '../../config/database.js';
import { AppError, forbidden, notFound } from '../../utils/errors.js';
import { toCamel, pageMeta } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify, adminIds, projectUserIds } from '../../services/notification.service.js';
import { saveUploadedFile, saveMany } from '../../services/fileStorage.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';
import * as approvals from '../approvals/approvals.repository.js';
import * as repo from './bills.repository.js';

const OPEN = ['PENDING_ADMIN_REVIEW', 'RESUBMITTED'];
const fileOpts = (ctx, projectId) => ({ category: 'vendor-bills', uploadedBy: ctx.user.id, projectId, visibility: 'INTERNAL' });

async function loadForUser(exec, user, id, { lock = false } = {}) {
  const bill = await repo.getRaw(exec, id, lock);
  if (!bill) throw notFound('Bill');
  if (user.role === 'CUSTOMER') throw forbidden('Customers cannot access vendor bills');
  await requireProjectAccess(exec, user, bill.project_id);
  return bill;
}

export async function createBill(ctx, body, files = {}) {
  const main = files.file?.[0];
  if (!main) throw new AppError(400, 'Upload the bill document (PDF or image)');
  return withTx(async (tx) => {
    const project = await requireProjectAccess(tx, ctx.user, body.projectId, { roles: ['PROJECT_MANAGER'] });
    const bill = await repo.insert(tx, { ...body, submittedBy: ctx.user.id });
    const file = await saveUploadedFile(tx, main, fileOpts(ctx, project.id));
    await repo.insertVersion(tx, bill.id, 1, file.id, bill.amount, 'Initial submission', ctx.user.id);
    for (const f of await saveMany(tx, files.attachments, fileOpts(ctx, project.id))) await repo.insertAttachment(tx, bill.id, 1, f.id);
    await repo.insertReview(tx, bill.id, 1, ctx.user.id, 'SUBMITTED', null, null, 'PENDING_ADMIN_REVIEW');
    await approvals.create(tx, { projectId: project.id, requesterId: ctx.user.id, type: 'BILL_REVIEW', entityType: 'vendor_bill', entityId: bill.id, title: `Bill ${bill.invoice_number} — ${bill.vendor_name}`, summary: `₹${bill.amount} for ${project.name}` });
    await recordAudit(tx, ctx, { action: 'BILL_SUBMITTED', module: 'BILLS', entityType: 'vendor_bill', entityId: bill.id, projectId: project.id, next: { invoiceNumber: bill.invoice_number, vendor: bill.vendor_name, amount: bill.amount, status: bill.status }, description: `Bill ${bill.invoice_number} submitted` });
    await notify(tx, { recipientIds: await adminIds(tx), projectId: project.id, type: 'BILL_SUBMITTED', title: 'New bill awaiting review', message: `${bill.vendor_name} — ${bill.invoice_number}`, entityType: 'vendor_bill', entityId: bill.id });
    return toCamel(await repo.getDetail(tx, bill.id));
  });
}

export async function listBills(user, query) {
  if (user.role === 'CUSTOMER') throw forbidden('Customers cannot access vendor bills');
  const { rows, total } = await repo.list(db, { user, ...query });
  return { data: toCamel(rows), meta: pageMeta(query.page, query.limit, total) };
}

export async function getBill(user, id) {
  await loadForUser(db, user, id);
  return toCamel(await repo.getDetail(db, id));
}

export async function getHistory(user, id) {
  await loadForUser(db, user, id);
  return toCamel(await repo.history(db, id));
}

export async function editBill(ctx, id, body) {
  return withTx(async (tx) => {
    const bill = await loadForUser(tx, ctx.user, id, { lock: true });
    if (ctx.user.role !== 'PROJECT_MANAGER' || bill.submitted_by !== ctx.user.id) throw forbidden('Only the submitting project manager can edit this bill');
    if (bill.status !== 'CLARIFICATION_REQUIRED') throw new AppError(409, 'Bills can only be edited while clarification is required');
    await repo.updateFields(tx, id, body);
    await recordAudit(tx, ctx, { action: 'BILL_UPDATED', module: 'BILLS', entityType: 'vendor_bill', entityId: id, projectId: bill.project_id, previous: { amount: bill.amount, vendor: bill.vendor_name, invoiceNumber: bill.invoice_number }, next: body, description: `Bill ${bill.invoice_number} edited` });
    return toCamel(await repo.getDetail(tx, id));
  });
}

export async function resubmit(ctx, id, { note, amount }, files = {}) {
  return withTx(async (tx) => {
    const bill = await loadForUser(tx, ctx.user, id, { lock: true });
    if (ctx.user.role !== 'PROJECT_MANAGER') throw forbidden('Only project managers can resubmit bills');
    if (bill.status !== 'CLARIFICATION_REQUIRED') throw new AppError(409, 'Only bills awaiting clarification can be resubmitted');
    const version = bill.current_version + 1;
    const revised = files.file?.[0];
    let fileId;
    if (revised) fileId = (await saveUploadedFile(tx, revised, fileOpts(ctx, bill.project_id))).id;
    else fileId = (await tx.query('select file_id from vendor_bill_versions where bill_id = $1 and version_no = $2', [id, bill.current_version])).rows[0].file_id;
    const newAmount = amount ?? bill.amount;
    await repo.insertVersion(tx, id, version, fileId, newAmount, note, ctx.user.id);
    for (const f of await saveMany(tx, files.attachments, fileOpts(ctx, bill.project_id))) await repo.insertAttachment(tx, id, version, f.id);
    await repo.updateFields(tx, id, { amount: newAmount });
    await repo.setStatus(tx, id, 'PENDING_ADMIN_REVIEW', { current_version: version });
    await repo.insertReview(tx, id, version, ctx.user.id, 'RESUBMITTED', note, bill.status, 'PENDING_ADMIN_REVIEW');
    await approvals.transitionForEntity(tx, { entityType: 'vendor_bill', entityId: id, status: 'PENDING', actorId: ctx.user.id, action: 'RESUBMITTED', comment: note });
    await recordAudit(tx, ctx, { action: 'BILL_RESUBMITTED', module: 'BILLS', entityType: 'vendor_bill', entityId: id, projectId: bill.project_id, previous: { status: bill.status, version: bill.current_version, amount: bill.amount }, next: { status: 'PENDING_ADMIN_REVIEW', version, amount: newAmount }, description: `Revised bill ${bill.invoice_number} submitted (v${version})` });
    await notify(tx, { recipientIds: await adminIds(tx), projectId: bill.project_id, type: 'BILL_RESUBMITTED', title: 'Revised bill awaiting review', message: `${bill.vendor_name} — ${bill.invoice_number} (v${version})`, entityType: 'vendor_bill', entityId: id });
    return toCamel(await repo.getDetail(tx, id));
  });
}

const REVIEW = {
  APPROVE: { status: 'APPROVED', approval: 'APPROVED', audit: 'BILL_APPROVED', note: false },
  REJECT: { status: 'REJECTED', approval: 'REJECTED', audit: 'BILL_REJECTED', note: true },
  REQUEST_CLARIFICATION: { status: 'CLARIFICATION_REQUIRED', approval: 'CLARIFICATION_REQUIRED', audit: 'BILL_CLARIFICATION_REQUESTED', note: true },
};

const MODE_LABEL = { CASH: 'Cash', UPI: 'UPI', CHEQUE: 'Cheque', NET_BANKING: 'Net banking', NEFT: 'NEFT', RTGS: 'RTGS', IMPS: 'IMPS', OTHER: 'Other' };

export async function review(ctx, id, action, comment, { paymentMode, paymentReference } = {}) {
  const rule = REVIEW[action];
  if (!rule) throw new AppError(400, 'Invalid review action');
  if (rule.note && !comment) throw new AppError(400, 'A comment is required for this action');
  return withTx(async (tx) => {
    const bill = await loadForUser(tx, ctx.user, id, { lock: true });
    if (ctx.user.role !== 'ADMIN') throw forbidden('Only admins can review bills');
    if (bill.submitted_by === ctx.user.id) throw forbidden('You cannot review your own bill');
    if (!OPEN.includes(bill.status)) throw new AppError(409, `Bill is ${bill.status.toLowerCase().replace(/_/g, ' ')} and cannot be reviewed`);
    let extra = {};
    let reviewComment = comment;
    if (action === 'APPROVE') {
      if (!paymentMode) throw new AppError(400, 'Select a mode of payment');
      if (paymentMode !== 'CASH' && !paymentReference) throw new AppError(400, 'Enter the reference (transaction ID / cheque number) for this payment mode');
      extra = { approved_at: new Date(), payment_mode: paymentMode, payment_reference: paymentReference ?? null };
      reviewComment = [comment, `Payment via ${MODE_LABEL[paymentMode]}${paymentReference ? ` (${paymentReference})` : ''}`].filter(Boolean).join(' — ');
    }
    await repo.setStatus(tx, id, rule.status, extra);
    await repo.insertReview(tx, id, bill.current_version, ctx.user.id, action, reviewComment, bill.status, rule.status);
    await approvals.transitionForEntity(tx, { entityType: 'vendor_bill', entityId: id, status: rule.approval, actorId: ctx.user.id, action, comment });
    await recordAudit(tx, ctx, { action: rule.audit, module: 'BILLS', entityType: 'vendor_bill', entityId: id, projectId: bill.project_id, previous: { status: bill.status }, next: { status: rule.status, comment, ...(paymentMode ? { paymentMode, paymentReference } : {}) }, description: `Bill ${bill.invoice_number}: ${rule.status.toLowerCase().replace(/_/g, ' ')}` });
    await notify(tx, { recipientIds: [bill.submitted_by, ...(await projectUserIds(tx, bill.project_id, 'PROJECT_MANAGER'))], projectId: bill.project_id, type: rule.audit, title: `Bill ${bill.invoice_number} ${rule.status.toLowerCase().replace(/_/g, ' ')}`, message: comment, entityType: 'vendor_bill', entityId: id });
    return toCamel(await repo.getDetail(tx, id));
  });
}

export async function markPaid(ctx, id, { paymentReference, paidDate }) {
  return withTx(async (tx) => {
    const bill = await loadForUser(tx, ctx.user, id, { lock: true });
    if (ctx.user.role !== 'ADMIN') throw forbidden('Only admins can settle bills');
    if (bill.status !== 'APPROVED') throw new AppError(409, 'Only approved bills can be marked as paid');
    const reference = paymentReference ?? bill.payment_reference;
    if (!reference && bill.payment_mode !== 'CASH') throw new AppError(400, 'Payment reference is required');
    await repo.setStatus(tx, id, 'PAID', { paid_at: paidDate ?? new Date(), payment_reference: reference ?? null });
    await repo.insertReview(tx, id, bill.current_version, ctx.user.id, 'MARK_PAID', reference, bill.status, 'PAID');
    await recordAudit(tx, ctx, { action: 'BILL_PAID', module: 'BILLS', entityType: 'vendor_bill', entityId: id, projectId: bill.project_id, previous: { status: 'APPROVED' }, next: { status: 'PAID', paymentReference: reference, paymentMode: bill.payment_mode }, description: `Bill ${bill.invoice_number} marked paid` });
    await notify(tx, { recipientIds: [bill.submitted_by], projectId: bill.project_id, type: 'BILL_PAID', title: `Bill ${bill.invoice_number} paid`, entityType: 'vendor_bill', entityId: id });
    return toCamel(await repo.getDetail(tx, id));
  });
}
