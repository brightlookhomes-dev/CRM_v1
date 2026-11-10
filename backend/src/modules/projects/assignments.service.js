import { badRequest, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';

const ROLE_FOR = { PROJECT_MANAGER: 'PROJECT_MANAGER', CUSTOMER: 'CUSTOMER' };

/** Assign a user to a project. Role of the user must match the assignment role. Idempotent. */
export async function assignUser(tx, ctx, projectId, userId, assignmentRole) {
  if (!ROLE_FOR[assignmentRole]) throw badRequest('Invalid assignment role');
  const { rows } = await tx.query('select id, role, status, full_name from users where id = $1', [userId]);
  const user = rows[0];
  if (!user) throw notFound('User');
  if (user.role !== assignmentRole) throw badRequest(`${user.full_name} is not a ${assignmentRole.replace('_', ' ').toLowerCase()}`);
  if (user.status !== 'ACTIVE') throw badRequest(`${user.full_name} is inactive`);
  const existing = await tx.query(
    'select 1 from project_assignments where project_id=$1 and user_id=$2 and assignment_role=$3 and is_active',
    [projectId, userId, assignmentRole]);
  if (existing.rows.length) return false;
  await tx.query(
    'insert into project_assignments (project_id, user_id, assignment_role, assigned_by) values ($1,$2,$3,$4)',
    [projectId, userId, assignmentRole, ctx.user.id]);
  await recordAudit(tx, ctx, { action: 'PROJECT_USER_ASSIGNED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId, next: { userId, assignmentRole }, description: `${user.full_name} assigned as ${assignmentRole}` });
  await notify(tx, { recipientIds: [userId], projectId, type: 'PROJECT_ASSIGNED', title: 'You were assigned to a project', entityType: 'project', entityId: projectId });
  return true;
}

export async function unassignUser(tx, ctx, projectId, assignmentId) {
  const { rows } = await tx.query(
    `update project_assignments set is_active = false, unassigned_at = now()
      where id = $1 and project_id = $2 and is_active returning user_id, assignment_role`, [assignmentId, projectId]);
  if (!rows[0]) throw notFound('Assignment');
  await recordAudit(tx, ctx, { action: 'PROJECT_USER_UNASSIGNED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId, previous: { userId: rows[0].user_id, assignmentRole: rows[0].assignment_role }, description: 'Project access removed' });
}

/** Make the active set of users for a role exactly `userIds`. */
export async function syncAssignments(tx, ctx, projectId, assignmentRole, userIds) {
  const { rows } = await tx.query(
    'select id, user_id from project_assignments where project_id=$1 and assignment_role=$2 and is_active', [projectId, assignmentRole]);
  const wanted = new Set(userIds);
  for (const r of rows) if (!wanted.has(r.user_id)) await unassignUser(tx, ctx, projectId, r.id);
  for (const id of wanted) await assignUser(tx, ctx, projectId, id, assignmentRole);
}

export const listAssignments = async (exec, projectId) =>
  (await exec.query(
    `select pa.id, pa.user_id, pa.assignment_role, pa.assigned_at, u.full_name, u.username, u.email
       from project_assignments pa join users u on u.id = pa.user_id
      where pa.project_id = $1 and pa.is_active order by pa.assignment_role, u.full_name`, [projectId])).rows;
