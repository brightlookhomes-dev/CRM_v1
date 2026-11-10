import { whereBuilder, offsetOf } from '../../utils/helpers.js';

const COLS = 'id, username, full_name, email, phone, role, status, last_login_at, created_at, updated_at';

export const insert = async (exec, u) =>
  (await exec.query(
    `insert into users (username, full_name, email, phone, password_hash, role, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${COLS}`,
    [u.username, u.fullName, u.email ?? null, u.phone ?? null, u.passwordHash, u.role, u.status ?? 'ACTIVE', u.createdBy])).rows[0];

export const findById = async (exec, id) =>
  (await exec.query(`select ${COLS} from users where id = $1`, [id])).rows[0];

export async function list(exec, { q, role, status, page, limit }) {
  const w = whereBuilder();
  if (q) { const p = w.p(`%${q}%`); w.and(`(full_name ilike ${p} or username ilike ${p} or email ilike ${p})`); }
  if (role) w.and(`role = ${w.p(role)}`);
  if (status) w.and(`status = ${w.p(status)}`);
  const total = (await exec.query(`select count(*)::int as n from users ${w.clause}`, w.params)).rows[0].n;
  const rows = (await exec.query(
    `select ${COLS},
       (select count(*)::int from project_assignments pa where pa.user_id = users.id and pa.is_active) as project_count
     from users ${w.clause} order by created_at desc limit ${limit} offset ${offsetOf(page, limit)}`, w.params)).rows;
  return { rows, total };
}

export async function update(exec, id, fields, updatedBy) {
  const map = { fullName: 'full_name', email: 'email', phone: 'phone', role: 'role', status: 'status', passwordHash: 'password_hash' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) { params.push(fields[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (!sets.length) return findById(exec, id);
  params.push(updatedBy, id);
  return (await exec.query(
    `update users set ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = now()
      where id = $${params.length} returning ${COLS}`, params)).rows[0];
}

export const userAssignments = async (exec, userId) =>
  (await exec.query(
    `select pa.id, pa.project_id, pa.assignment_role, p.name as project_name, p.project_code
       from project_assignments pa join projects p on p.id = pa.project_id
      where pa.user_id = $1 and pa.is_active and p.deleted_at is null order by pa.assigned_at desc`, [userId])).rows;

export const recentActivity = async (exec, userId) =>
  (await exec.query(
    `select id, action_type, module, description, created_at from audit_logs
      where actor_user_id = $1 order by created_at desc limit 25`, [userId])).rows;
