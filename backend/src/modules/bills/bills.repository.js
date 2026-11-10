import { whereBuilder, offsetOf } from '../../utils/helpers.js';

export const insert = async (exec, b) =>
  (await exec.query(
    `insert into vendor_bills (project_id, submitted_by, vendor_name, invoice_number, amount, tax_amount, bill_date, due_date, description, category, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING_ADMIN_REVIEW') returning *`,
    [b.projectId, b.submittedBy, b.vendorName, b.invoiceNumber, b.amount, b.taxAmount ?? null, b.billDate, b.dueDate ?? null, b.description ?? null, b.category])).rows[0];

export const getRaw = async (exec, id, lock = false) =>
  (await exec.query(`select * from vendor_bills where id = $1 ${lock ? 'for update' : ''}`, [id])).rows[0];

export const insertVersion = (exec, billId, versionNo, fileId, amount, note, userId) =>
  exec.query('insert into vendor_bill_versions (bill_id, version_no, file_id, amount, note, submitted_by) values ($1,$2,$3,$4,$5,$6)',
    [billId, versionNo, fileId, amount, note ?? null, userId]);

export const insertAttachment = (exec, billId, versionNo, fileId) =>
  exec.query('insert into vendor_bill_attachments (bill_id, version_no, file_id) values ($1,$2,$3)', [billId, versionNo, fileId]);

export const insertReview = (exec, billId, versionNo, actorId, action, comment, prev, next) =>
  exec.query(
    'insert into vendor_bill_reviews (bill_id, version_no, actor_id, action, comment, previous_status, new_status) values ($1,$2,$3,$4,$5,$6,$7)',
    [billId, versionNo, actorId, action, comment ?? null, prev, next]);

export async function setStatus(exec, id, status, extra = {}) {
  const sets = ['status = $2', 'updated_at = now()']; const params = [id, status];
  for (const [col, val] of Object.entries(extra)) { params.push(val); sets.push(`${col} = $${params.length}`); }
  await exec.query(`update vendor_bills set ${sets.join(', ')} where id = $1`, params);
}

export async function updateFields(exec, id, f) {
  const map = { vendorName: 'vendor_name', invoiceNumber: 'invoice_number', amount: 'amount', taxAmount: 'tax_amount', billDate: 'bill_date', dueDate: 'due_date', description: 'description', category: 'category' };
  const sets = []; const params = [id];
  for (const [k, col] of Object.entries(map)) if (f[k] !== undefined) { params.push(f[k]); sets.push(`${col} = $${params.length}`); }
  if (sets.length) await exec.query(`update vendor_bills set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
}

const SELECT = `
  select b.*, p.name as project_name, p.project_code, u.full_name as submitted_by_name,
    (select f.id from vendor_bill_versions v join files f on f.id = v.file_id where v.bill_id = b.id and v.version_no = b.current_version) as current_file_id,
    (select f.original_name from vendor_bill_versions v join files f on f.id = v.file_id where v.bill_id = b.id and v.version_no = b.current_version) as current_file_name,
    (select r.comment from vendor_bill_reviews r where r.bill_id = b.id and r.action = 'REQUEST_CLARIFICATION' order by r.created_at desc limit 1) as last_clarification
  from vendor_bills b join projects p on p.id = b.project_id join users u on u.id = b.submitted_by`;

export async function list(exec, { user, projectId, pmId, vendor, status, dateFrom, dateTo, minAmount, maxAmount, q, page, limit }) {
  const w = whereBuilder();
  if (user.role !== 'ADMIN') {
    w.and(`exists (select 1 from project_assignments x where x.project_id = b.project_id and x.user_id = ${w.p(user.id)} and x.assignment_role = 'PROJECT_MANAGER' and x.is_active)`);
  }
  if (projectId) w.and(`b.project_id = ${w.p(projectId)}`);
  if (pmId) w.and(`b.submitted_by = ${w.p(pmId)}`);
  if (vendor) w.and(`b.vendor_name ilike ${w.p(`%${vendor}%`)}`);
  if (status) w.and(`b.status = ${w.p(status)}`);
  if (dateFrom) w.and(`b.bill_date >= ${w.p(dateFrom)}`);
  if (dateTo) w.and(`b.bill_date <= ${w.p(dateTo)}`);
  if (minAmount !== undefined) w.and(`b.amount >= ${w.p(minAmount)}`);
  if (maxAmount !== undefined) w.and(`b.amount <= ${w.p(maxAmount)}`);
  if (q) { const p = w.p(`%${q}%`); w.and(`(b.invoice_number ilike ${p} or b.vendor_name ilike ${p})`); }
  const total = (await exec.query(`select count(*)::int as n from vendor_bills b ${w.clause}`, w.params)).rows[0].n;
  const rows = (await exec.query(
    `${SELECT} ${w.clause} order by (b.status = 'PENDING_ADMIN_REVIEW') desc, b.created_at desc limit ${limit} offset ${offsetOf(page, limit)}`, w.params)).rows;
  return { rows, total };
}

export const getDetail = async (exec, id) => (await exec.query(`${SELECT} where b.id = $1`, [id])).rows[0];

export async function history(exec, id) {
  const versions = (await exec.query(
    `select v.version_no, v.amount, v.note, v.created_at, v.file_id, f.original_name as file_name, u.full_name as submitted_by_name,
       (select coalesce(json_agg(json_build_object('id', f2.id, 'name', f2.original_name)), '[]'::json)
          from vendor_bill_attachments a join files f2 on f2.id = a.file_id where a.bill_id = v.bill_id and a.version_no = v.version_no) as attachments
       from vendor_bill_versions v join files f on f.id = v.file_id join users u on u.id = v.submitted_by
      where v.bill_id = $1 order by v.version_no`, [id])).rows;
  const reviews = (await exec.query(
    `select r.*, u.full_name as actor_name from vendor_bill_reviews r left join users u on u.id = r.actor_id
      where r.bill_id = $1 order by r.created_at`, [id])).rows;
  return { versions, reviews };
}
