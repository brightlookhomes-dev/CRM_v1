import { db, withTx } from '../../config/database.js';
import { AppError, notFound } from '../../utils/errors.js';
import { toCamel, pageMeta, paymentSummary, round2, whereBuilder, offsetOf } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify, projectUserIds } from '../../services/notification.service.js';
import { buildInvoiceDocx, splitGst } from '../../services/invoiceDocx.service.js';
import { saveUploadedFile } from '../../services/fileStorage.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';

const SELECT = `
  select cp.*, u.full_name as recorded_by_name, p.name as project_name
    from customer_payments cp join users u on u.id = cp.recorded_by join projects p on p.id = cp.project_id`;

const netReceived = async (exec, projectId) =>
  (await exec.query('select coalesce(sum(amount), 0) as n from customer_payments where project_id = $1', [projectId])).rows[0].n;

export async function summaryFor(exec, projectId, contractAmount) {
  return paymentSummary(contractAmount, await netReceived(exec, projectId));
}

/** Records an advance/installment/milestone/final payment or a refund. Serialised per project via row lock. */
export async function recordPayment(ctx, projectId, body, receipt) {
  return withTx(async (tx) => {
    await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN'] });
    const project = (await tx.query('select * from projects where id = $1 for update', [projectId])).rows[0];
    const received = await netReceived(tx, projectId);
    const isRefund = body.entryType === 'REFUND';
    if (isRefund && body.amount > received) throw new AppError(409, 'Refund exceeds the net amount received');
    if (!isRefund && round2(received + body.amount) > Number(project.contract_amount)) {
      throw new AppError(409, `Payment exceeds the outstanding amount (₹${round2(project.contract_amount - received)})`);
    }
    const file = receipt ? await saveUploadedFile(tx, receipt, { category: 'payments', uploadedBy: ctx.user.id, projectId }) : null;
    let invoiceNumber = null;
    if (!isRefund) {
      // Numbered per project (project row is locked above, so concurrent payments cannot collide).
      const year = Number(body.paymentDate.slice(0, 4));
      const code = project.project_code.split('-').pop();
      const { rows: c } = await tx.query(
        `select coalesce(max(split_part(invoice_number, '/', 4)::int), 0) + 1 as n
           from customer_payments where project_id = $1 and invoice_number is not null`, [projectId]);
      invoiceNumber = `BLH/${year}/${code}/${String(c[0].n).padStart(3, '0')}`;
    }
    const invoiceDescription = isRefund ? null : (body.invoiceDescription || `${project.name} - ${body.paymentType.toLowerCase()} payment`);
    const { rows } = await tx.query(
      `insert into customer_payments (project_id, entry_type, payment_type, amount, payment_method, payment_date, reference_number, receipt_file_id, notes, recorded_by, invoice_number, invoice_description)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [projectId, isRefund ? 'REFUND' : 'PAYMENT', isRefund ? null : body.paymentType, isRefund ? -body.amount : body.amount, body.paymentMethod,
        body.paymentDate, body.referenceNumber, file?.id ?? null, body.notes ?? null, ctx.user.id, invoiceNumber, invoiceDescription]);
    const payment = rows[0];
    await recordAudit(tx, ctx, { action: isRefund ? 'REFUND_RECORDED' : 'PAYMENT_RECORDED', module: 'PAYMENTS', entityType: 'customer_payment', entityId: payment.id, projectId, next: { amount: payment.amount, method: payment.payment_method, reference: payment.reference_number, paymentType: payment.payment_type, invoiceNumber }, description: `${isRefund ? 'Refund' : 'Payment'} of ₹${body.amount} recorded` });
    await notify(tx, { recipientIds: [...(await projectUserIds(tx, projectId, 'CUSTOMER')), ...(await projectUserIds(tx, projectId, 'PROJECT_MANAGER'))], projectId, type: 'PAYMENT_RECORDED', title: isRefund ? 'A refund was recorded' : 'A payment was recorded', message: `₹${body.amount} (${body.referenceNumber})`, entityType: 'customer_payment', entityId: payment.id });
    return { payment: toCamel(payment), summary: await summaryFor(tx, projectId, project.contract_amount) };
  });
}

export async function listForProject(user, projectId, { page, limit }) {
  const project = await requireProjectAccess(db, user, projectId);
  const total = (await db.query('select count(*)::int as n from customer_payments where project_id = $1', [projectId])).rows[0].n;
  const rows = (await db.query(`${SELECT} where cp.project_id = $1 order by cp.payment_date desc, cp.created_at desc limit ${limit} offset ${offsetOf(page, limit)}`, [projectId])).rows;
  return { data: toCamel(rows), meta: { ...pageMeta(page, limit, total), summary: await summaryFor(db, projectId, project.contract_amount) } };
}

export async function listAll({ projectId, method, entryType, dateFrom, dateTo, q, page, limit }) {
  const w = whereBuilder();
  if (projectId) w.and(`cp.project_id = ${w.p(projectId)}`);
  if (method) w.and(`cp.payment_method = ${w.p(method)}`);
  if (entryType) w.and(`cp.entry_type = ${w.p(entryType)}`);
  if (dateFrom) w.and(`cp.payment_date >= ${w.p(dateFrom)}`);
  if (dateTo) w.and(`cp.payment_date <= ${w.p(dateTo)}`);
  if (q) { const p = w.p(`%${q}%`); w.and(`(cp.reference_number ilike ${p} or p.name ilike ${p})`); }
  const total = (await db.query(`select count(*)::int as n from customer_payments cp join projects p on p.id = cp.project_id ${w.clause}`, w.params)).rows[0].n;
  const rows = (await db.query(`${SELECT} ${w.clause} order by cp.payment_date desc, cp.created_at desc limit ${limit} offset ${offsetOf(page, limit)}`, w.params)).rows;
  return { data: toCamel(rows), meta: pageMeta(page, limit, total) };
}

export async function getPayment(user, id) {
  const row = (await db.query(`${SELECT} where cp.id = $1`, [id])).rows[0];
  if (!row) throw notFound('Payment');
  await requireProjectAccess(db, user, row.project_id);
  return toCamel(row);
}

/** Builds the tax-invoice Word document for a customer payment (admin, or the assigned customer). */
export async function getInvoiceDocx(user, id) {
  const row = (await db.query(
    `select cp.*, p.name as project_name, p.location as project_location from customer_payments cp
       join projects p on p.id = cp.project_id where cp.id = $1`, [id])).rows[0];
  if (!row || !row.invoice_number) throw notFound('Invoice');
  await requireProjectAccess(db, user, row.project_id);
  const customers = (await db.query(
    `select u.full_name from project_assignments pa join users u on u.id = pa.user_id
      where pa.project_id = $1 and pa.assignment_role = 'CUSTOMER' and pa.is_active order by pa.assigned_at`, [row.project_id])).rows;
  const buffer = await buildInvoiceDocx({
    invoiceNumber: row.invoice_number, invoiceDate: row.payment_date, clientName: customers.map((c) => c.full_name).join(' & ') || '—',
    projectAddress: row.project_location, description: row.invoice_description || row.project_name, ...splitGst(row.amount),
  });
  return { buffer, invoiceNumber: row.invoice_number };
}
