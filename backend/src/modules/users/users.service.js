import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, withTx } from '../../config/database.js';
import { AppError, notFound } from '../../utils/errors.js';
import { toCamel, pageMeta } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { assignUser } from '../projects/assignments.service.js';
import { revokeAllForUser } from '../auth/auth.repository.js';
import * as repo from './users.repository.js';

const hash = (pw) => bcrypt.hash(pw, 11);
const generatePassword = () => `Bl-${crypto.randomBytes(6).toString('base64url')}9!`;

export async function createUser(ctx, body) {
  return withTx(async (tx) => {
    const user = await repo.insert(tx, { ...body, passwordHash: await hash(body.password), createdBy: ctx.user.id });
    if (body.role !== 'ADMIN') {
      for (const projectId of body.projectIds ?? []) await assignUser(tx, ctx, projectId, user.id, body.role);
    }
    await recordAudit(tx, ctx, { action: 'USER_CREATED', module: 'USERS', entityType: 'user', entityId: user.id, next: { username: user.username, role: user.role, email: user.email }, description: `User ${user.username} created` });
    return toCamel(user);
  });
}

export async function listUsers(query) {
  const { rows, total } = await repo.list(db, query);
  return { data: toCamel(rows), meta: pageMeta(query.page, query.limit, total) };
}

export async function getUser(id) {
  const user = await repo.findById(db, id);
  if (!user) throw notFound('User');
  const [assignments, activity] = await Promise.all([repo.userAssignments(db, id), repo.recentActivity(db, id)]);
  return { ...toCamel(user), assignments: toCamel(assignments), recentActivity: toCamel(activity) };
}

export async function updateUser(ctx, id, body) {
  return withTx(async (tx) => {
    const before = await repo.findById(tx, id);
    if (!before) throw notFound('User');
    if (body.role && body.role !== before.role && id === ctx.user.id) throw new AppError(409, 'You cannot change your own role');
    const after = await repo.update(tx, id, body, ctx.user.id);
    await recordAudit(tx, ctx, { action: 'USER_UPDATED', module: 'USERS', entityType: 'user', entityId: id, previous: { fullName: before.full_name, email: before.email, phone: before.phone, role: before.role }, next: { fullName: after.full_name, email: after.email, phone: after.phone, role: after.role }, description: `User ${before.username} updated` });
    return toCamel(after);
  });
}

export async function setStatus(ctx, id, status) {
  if (id === ctx.user.id && status === 'INACTIVE') throw new AppError(409, 'You cannot deactivate your own account');
  return withTx(async (tx) => {
    const before = await repo.findById(tx, id);
    if (!before) throw notFound('User');
    const after = await repo.update(tx, id, { status }, ctx.user.id);
    if (status === 'INACTIVE') await revokeAllForUser(tx, id);
    await recordAudit(tx, ctx, { action: status === 'ACTIVE' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', module: 'USERS', entityType: 'user', entityId: id, previous: { status: before.status }, next: { status }, description: `User ${before.username} ${status.toLowerCase()}` });
    return toCamel(after);
  });
}

/** Admin sets a new password, or one is generated and returned exactly once. */
export async function resetPassword(ctx, id, newPassword) {
  const temp = newPassword ?? generatePassword();
  return withTx(async (tx) => {
    const user = await repo.findById(tx, id);
    if (!user) throw notFound('User');
    await repo.update(tx, id, { passwordHash: await hash(temp) }, ctx.user.id);
    await revokeAllForUser(tx, id);
    await recordAudit(tx, ctx, { action: 'PASSWORD_RESET', module: 'AUTH', entityType: 'user', entityId: id, description: `Password reset for ${user.username} by admin` });
    return newPassword ? { reset: true } : { reset: true, temporaryPassword: temp };
  });
}
