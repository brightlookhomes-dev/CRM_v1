import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam } from '../../validators/common.js';
import { asyncHandler, send } from '../../utils/helpers.js';
import * as svc from './purge.service.js';

// Hard deletes require an explicit confirm:"DELETE" so a stray request can never destroy data.
const confirmBody = z.object({ confirm: z.literal('DELETE', { errorMap: () => ({ message: 'Send confirm: "DELETE" to permanently delete' }) }) });
const route = (path, fn, message) => [path, authenticate, authorize('ADMIN'), validate({ params: idParam, body: confirmBody }),
  asyncHandler(async (req, res) => { await fn(req.ctx, req.valid.params.id); send(res, message); })];

const router = Router();
router.delete(...route('/projects/:id/permanent', svc.purgeProject, 'Project permanently deleted'));
router.delete(...route('/bills/:id/permanent', svc.purgeBill, 'Bill permanently deleted'));
router.delete(...route('/project-updates/:id/permanent', svc.purgeUpdate, 'Update permanently deleted'));
router.delete(...route('/users/:id/permanent', svc.purgeUser, 'User permanently deleted'));
export default router;
