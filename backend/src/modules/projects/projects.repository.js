import { whereBuilder, offsetOf } from '../../utils/helpers.js';

const people = (role) => `
  (select coalesce(json_agg(json_build_object('id', u.id, 'fullName', u.full_name) order by u.full_name), '[]'::json)
     from project_assignments pa join users u on u.id = pa.user_id
    where pa.project_id = p.id and pa.is_active and pa.assignment_role = '${role}')`;

const SELECT = `
  select p.*,
    coalesce((select sum(cp.amount) from customer_payments cp where cp.project_id = p.id), 0) as total_received,
    (select count(*)::int from decision_requests d where d.project_id = p.id and d.status = 'PENDING_CUSTOMER') as pending_decisions,
    (select count(*)::int from approval_requests a where a.project_id = p.id and a.status = 'PENDING') as pending_approvals,
    ${people('PROJECT_MANAGER')} as project_managers,
    ${people('CUSTOMER')} as customers
  from projects p`;

const SORTS = { created_at: 'p.created_at', name: 'p.name', overall_progress: 'p.overall_progress', status: 'p.status' };

export async function list(exec, { user, q, status, pmId, customerId, page, limit, sort = 'created_at', order = 'desc' }) {
  const w = whereBuilder();
  w.and('p.deleted_at is null');
  if (user.role !== 'ADMIN') {
    w.and(`exists (select 1 from project_assignments x where x.project_id = p.id and x.user_id = ${w.p(user.id)}
                    and x.assignment_role = ${w.p(user.role)} and x.is_active)`);
  }
  if (q) { const p = w.p(`%${q}%`); w.and(`(p.name ilike ${p} or p.project_code ilike ${p} or p.location ilike ${p})`); }
  if (status) w.and(`p.status = ${w.p(status)}`);
  if (pmId) w.and(`exists (select 1 from project_assignments x where x.project_id = p.id and x.user_id = ${w.p(pmId)} and x.assignment_role = 'PROJECT_MANAGER' and x.is_active)`);
  if (customerId) w.and(`exists (select 1 from project_assignments x where x.project_id = p.id and x.user_id = ${w.p(customerId)} and x.assignment_role = 'CUSTOMER' and x.is_active)`);
  const total = (await exec.query(`select count(*)::int as n from projects p ${w.clause}`, w.params)).rows[0].n;
  const rows = (await exec.query(
    `${SELECT} ${w.clause} order by ${SORTS[sort] ?? SORTS.created_at} ${order === 'asc' ? 'asc' : 'desc'}, p.id
      limit ${limit} offset ${offsetOf(page, limit)}`, w.params)).rows;
  return { rows, total };
}

export const getById = async (exec, id) =>
  (await exec.query(`${SELECT} where p.id = $1`, [id])).rows[0];

export const nextCode = async (exec) => {
  const n = (await exec.query("select nextval('project_code_seq') as n")).rows[0].n;
  return `BLH-${new Date().getFullYear()}-${n}`;
};

export const insert = async (exec, p) =>
  (await exec.query(
    `insert into projects (project_code, name, description, location, project_type, contract_amount, start_date,
        expected_completion_date, overall_progress, status, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) returning *`,
    [p.code, p.name, p.description ?? null, p.location, p.projectType, p.contractAmount ?? 0, p.startDate ?? null,
      p.expectedCompletionDate ?? null, p.overallProgress ?? 0, p.status ?? 'PLANNED', p.createdBy])).rows[0];

export async function update(exec, id, fields, updatedBy) {
  const map = {
    name: 'name', description: 'description', location: 'location', projectType: 'project_type',
    contractAmount: 'contract_amount', startDate: 'start_date', expectedCompletionDate: 'expected_completion_date',
    actualCompletionDate: 'actual_completion_date', overallProgress: 'overall_progress', status: 'status',
    coverImageFileId: 'cover_image_file_id',
  };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) { params.push(fields[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (!sets.length) return null;
  params.push(updatedBy, id);
  return (await exec.query(
    `update projects set ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = now()
      where id = $${params.length} and deleted_at is null returning *`, params)).rows[0];
}

export const insertProgressHistory = (exec, projectId, previous, next, userId, note) =>
  exec.query(
    'insert into project_progress_history (project_id, previous_progress, new_progress, changed_by, note) values ($1,$2,$3,$4,$5)',
    [projectId, previous, next, userId, note ?? null]);

export const hasProtectedHistory = async (exec, id) =>
  (await exec.query(
    `select (exists (select 1 from customer_payments where project_id = $1)
          or exists (select 1 from vendor_bills where project_id = $1)) as protected`, [id])).rows[0].protected;

export const softDelete = (exec, id) => exec.query('update projects set deleted_at = now(), updated_at = now() where id = $1', [id]);

export const progressHistory = async (exec, id) =>
  (await exec.query(
    `select h.*, u.full_name as changed_by_name from project_progress_history h
       left join users u on u.id = h.changed_by where h.project_id = $1 order by h.created_at desc limit 50`, [id])).rows;
