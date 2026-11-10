import { notFound, forbidden } from '../utils/errors.js';

/**
 * Resource-level authorization. ADMIN can access everything; PMs and customers only
 * projects they are actively assigned to in their own role. Returns the project row.
 */
export async function requireProjectAccess(exec, user, projectId, { roles } = {}) {
  if (roles && !roles.includes(user.role)) throw forbidden('Your role cannot perform this action');
  const { rows } = await exec.query('select * from projects where id = $1', [projectId]);
  const project = rows[0];
  if (!project || (project.deleted_at && user.role !== 'ADMIN')) throw notFound('Project');
  if (user.role === 'ADMIN') return project;
  const a = await exec.query(
    `select 1 from project_assignments
      where project_id = $1 and user_id = $2 and assignment_role = $3 and is_active`,
    [projectId, user.id, user.role],
  );
  if (!a.rows.length) throw forbidden('You are not assigned to this project');
  return project;
}
