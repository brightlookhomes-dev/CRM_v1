import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam, uuid, opt, pageQuery } from '../../validators/common.js';
import * as c from './users.controller.js';

const ROLES = z.enum(['ADMIN', 'PROJECT_MANAGER', 'CUSTOMER']);
const password = z.string().min(8, 'Password must be at least 8 characters').max(100);
const phone = opt(z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Invalid phone number'));

const createBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits . _ - only'),
  email: opt(z.string().trim().email()),
  phone,
  password,
  role: ROLES,
  status: opt(z.enum(['ACTIVE', 'INACTIVE'])),
  projectIds: opt(z.array(uuid)),
});
const updateBody = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/).nullable().optional(),
  role: ROLES.optional(),
});
const listQuery = z.object({ ...pageQuery, role: opt(ROLES), status: opt(z.enum(['ACTIVE', 'INACTIVE'])) });

const router = Router();
router.use(authenticate, authorize('ADMIN'));
router.post('/', validate({ body: createBody }), c.create);
router.get('/', validate({ query: listQuery }), c.list);
router.get('/:id', validate({ params: idParam }), c.get);
router.patch('/:id', validate({ params: idParam, body: updateBody }), c.update);
router.patch('/:id/status', validate({ params: idParam, body: z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }) }), c.setStatus);
router.post('/:id/reset-password', validate({ params: idParam, body: z.object({ newPassword: password.optional() }) }), c.resetPassword);
export default router;
