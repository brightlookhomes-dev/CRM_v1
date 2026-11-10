import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config/environment.js';
import { db, withTx } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { recordAudit } from '../../services/auditLog.service.js';
import * as repo from './auth.repository.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);
const DAY = 86_400_000;

export const publicUser = (u) => ({
  id: u.id, username: u.username, fullName: u.full_name, email: u.email, phone: u.phone, role: u.role, status: u.status,
});

const signAccess = (user) => jwt.sign({ role: user.role }, config.jwtSecret, { subject: user.id, expiresIn: config.accessTtl });

async function issueTokens(exec, user, remember) {
  const days = remember ? config.refreshTtlRememberDays : config.refreshTtlDays;
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + days * DAY);
  const row = await repo.insertRefreshToken(exec, { userId: user.id, tokenHash: sha256(refreshToken), expiresAt });
  return { accessToken: signAccess(user), refreshToken, refreshExpiresAt: expiresAt, refreshId: row.id };
}

export async function login(ctx, { username, password, remember }) {
  const user = await repo.findByUsername(db, username);
  const fail = async (reason, actor) => {
    await recordAudit(db, ctx, {
      actor: actor ? { id: actor.id, role: actor.role } : null,
      action: 'LOGIN_FAILED', module: 'AUTH', entityType: 'user', entityId: actor?.id,
      description: `Failed login for "${username}" (${reason})`,
    });
    throw new AppError(401, 'Invalid username or password');
  };
  if (!user) { await bcrypt.compare(password, DUMMY_HASH); return fail('unknown user'); }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(423, 'Account temporarily locked after repeated failures. Try again later.');
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    await repo.registerFailure(db, user.id);
    return fail('wrong password', user);
  }
  if (user.status !== 'ACTIVE') return fail('inactive account', user);

  const tokens = await withTx(async (tx) => {
    await repo.registerSuccess(tx, user.id);
    const t = await issueTokens(tx, user, remember);
    await recordAudit(tx, ctx, { actor: { id: user.id, role: user.role }, action: 'LOGIN', module: 'AUTH', entityType: 'user', entityId: user.id, description: `${user.username} logged in` });
    return t;
  });
  return { user: publicUser(user), ...tokens };
}

export async function refresh(rawToken) {
  if (!rawToken) throw new AppError(401, 'No refresh token');
  const row = await repo.findRefreshToken(db, sha256(rawToken));
  if (!row) throw new AppError(401, 'Invalid refresh token');
  if (row.revoked_at) {
    // A rotated token being replayed means it may be stolen: kill every session for that user.
    await repo.revokeAllForUser(db, row.user_id);
    throw new AppError(401, 'Session invalidated, please sign in again');
  }
  if (new Date(row.expires_at) < new Date()) throw new AppError(401, 'Session expired');
  const user = await repo.findById(db, row.user_id);
  if (!user || user.status !== 'ACTIVE') throw new AppError(401, 'Account is not active');
  const remember = new Date(row.expires_at) - Date.now() > config.refreshTtlDays * DAY;
  const tokens = await withTx(async (tx) => {
    const t = await issueTokens(tx, user, remember);
    await repo.revokeRefreshToken(tx, row.id, t.refreshId);
    return t;
  });
  return { user: publicUser(user), ...tokens };
}

export async function logout(ctx, rawToken) {
  if (rawToken) {
    const row = await repo.findRefreshToken(db, sha256(rawToken));
    if (row) {
      await repo.revokeRefreshToken(db, row.id);
      const user = await repo.findById(db, row.user_id);
      await recordAudit(db, ctx, { actor: user && { id: user.id, role: user.role }, action: 'LOGOUT', module: 'AUTH', entityType: 'user', entityId: row.user_id, description: 'User logged out' });
    }
  }
}

export async function me(userId) {
  const user = await repo.findById(db, userId);
  return publicUser(user);
}
