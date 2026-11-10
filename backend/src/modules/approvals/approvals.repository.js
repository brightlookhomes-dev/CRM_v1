import { whereBuilder, offsetOf } from '../../utils/helpers.js';

export const create = async (exec, a) =>
  (await exec.query(
    `insert into approval_requests (project_id, requester_id, approval_type, entity_type, entity_id, title, summary)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [a.projectId, a.requesterId, a.type, a.entityType, a.entityId, a.title, a.summary ?? null])).rows[0];

export const findOpenByEntity = async (exec, entityType, entityId) =>
  (await exec.query(
    `select * from approval_requests where entity_type = $1 and entity_id = $2
      order by requested_at desc limit 1 for update`, [entityType, entityId])).rows[0];

/** Move the approval linked to an entity to a new status and log the action. No-op if none exists. */
export async function transitionForEntity(exec, { entityType, entityId, status, actorId, action, comment }) {
  const a = await findOpenByEntity(exec, entityType, entityId);
  if (!a) return null;
  const resolved = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(status);
  await exec.query(
    'update approval_requests set status = $2, resolved_at = case when $3::boolean then now() else null end where id = $1',
    [a.id, status, resolved]);
  await exec.query(
    `insert into approval_actions (approval_id, actor_id, action, comment, previous_status, new_status)
     values ($1,$2,$3,$4,$5,$6)`, [a.id, actorId, action, comment ?? null, a.status, status]);
  return a;
}

export async function list(exec, { status, type, projectId, page, limit }) {
  const w = whereBuilder();
  if (status) w.and(`a.status = ${w.p(status)}`);
  if (type) w.and(`a.approval_type = ${w.p(type)}`);
  if (projectId) w.and(`a.project_id = ${w.p(projectId)}`);
  const total = (await exec.query(`select count(*)::int as n from approval_requests a ${w.clause}`, w.params)).rows[0].n;
  const rows = (await exec.query(
    `select a.*, p.name as project_name, u.full_name as requester_name from approval_requests a
       join projects p on p.id = a.project_id join users u on u.id = a.requester_id
     ${w.clause} order by (a.status = 'PENDING') desc, a.requested_at desc
     limit ${limit} offset ${offsetOf(page, limit)}`, w.params)).rows;
  return { rows, total };
}

export async function getDetail(exec, id) {
  const a = (await exec.query(
    `select a.*, p.name as project_name, u.full_name as requester_name from approval_requests a
       join projects p on p.id = a.project_id join users u on u.id = a.requester_id where a.id = $1`, [id])).rows[0];
  if (!a) return null;
  const actions = (await exec.query(
    `select x.*, u.full_name as actor_name from approval_actions x left join users u on u.id = x.actor_id
      where x.approval_id = $1 order by x.created_at`, [id])).rows;
  return { ...a, actions };
}
