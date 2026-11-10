import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam, dateStr, opt } from '../../validators/common.js';
import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './ledger.service.js';

// Mounted at /projects/:id/ledger — admin only.
const router = Router({ mergeParams: true });
router.use(authenticate, authorize('ADMIN'));
router.get('/', validate({ params: idParam, query: z.object({ from: opt(dateStr), to: opt(dateStr), format: opt(z.enum(['json', 'xlsx'])) }) }),
  asyncHandler(async (req, res) => {
    const { from, to, format } = req.valid.query;
    const ledger = await service.getLedger(req.user, req.valid.params.id, { from, to });
    if (format === 'xlsx') {
      const buffer = Buffer.from(await service.toXlsx(ledger));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Ledger ${ledger.project.code}.xlsx"`);
      return res.end(buffer);
    }
    return send(res, 'Ledger retrieved', ledger);
  }));
export default router;
