import jwt from 'jsonwebtoken';
import { config } from '../config/environment.js';
import { db } from '../config/database.js';
import { AppError, forbidden } from '../utils/errors.js';
import { asyncHandler, requestContext } from '../utils/helpers.js';

export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.get('authorization');
  const token = req.cookies?.access_token || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) throw new AppError(401, 'Authentication required');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new AppError(401, 'Session expired or invalid');
  }
  // Load from DB on every request so deactivation takes effect immediately.
  const { rows } = await db.query('select id, username, full_name, role, status from users where id = $1', [payload.sub]);
  const u = rows[0];
  if (!u || u.status !== 'ACTIVE') throw new AppError(401, 'Account is not active');
  req.user = { id: u.id, username: u.username, fullName: u.full_name, role: u.role };
  req.ctx = requestContext(req);
  next();
});

export const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden('Your role cannot access this resource'));

// Cookie auth is SameSite=Lax; this custom-header check blocks cross-site form posts (CSRF).
export const csrfGuard = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('authorization')) return next();
  if (req.get('x-requested-with') !== 'brightlook') return next(new AppError(403, 'Missing CSRF header'));
  next();
};
