import { Router } from 'express';
import { z } from 'zod';
import { validate, loginLimiter } from '../../middleware/common.js';
import { authenticate } from '../../middleware/auth.js';
import { boolish, opt } from '../../validators/common.js';
import * as c from './auth.controller.js';

const loginBody = z.object({
  username: z.string().trim().min(1, 'Username is required').max(100),
  password: z.string().min(1, 'Password is required').max(200),
  remember: opt(boolish),
});

const router = Router();
router.post('/login', loginLimiter, validate({ body: loginBody }), c.login);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);
router.get('/me', authenticate, c.me);
export default router;
