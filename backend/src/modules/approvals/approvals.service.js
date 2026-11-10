import { db } from '../../config/database.js';
import { AppError, notFound } from '../../utils/errors.js';
import { toCamel, pageMeta } from '../../utils/helpers.js';
import * as billsService from '../bills/bills.service.js';
import * as decisionsService from '../decisions/decisions.service.js';
import * as repo from './approvals.repository.js';

export async function listApprovals(query) {
  const { rows, total } = await repo.list(db, query);
  return { data: toCamel(rows), meta: pageMeta(query.page, query.limit, total) };
}

export async function getApproval(id) {
  const a = await repo.getDetail(db, id);
  if (!a) throw notFound('Approval');
  return toCamel({ ...a, actions: toCamel(a.actions) });
}

const DISPATCH = {
  vendor_bill: {
    APPROVE: (ctx, a, c, extra) => billsService.review(ctx, a.entity_id, 'APPROVE', c, extra),
    REJECT: (ctx, a, c) => billsService.review(ctx, a.entity_id, 'REJECT', c),
    CLARIFY: (ctx, a, c) => billsService.review(ctx, a.entity_id, 'REQUEST_CLARIFICATION', c),
  },
  decision: {
    APPROVE: (ctx, a, c) => decisionsService.finalize(ctx, a.entity_id, 'APPROVE', c, { viaApproval: true }),
    REJECT: (ctx, a, c) => decisionsService.finalize(ctx, a.entity_id, 'REJECT', c, { viaApproval: true }),
    CLARIFY: (ctx, a, c) => decisionsService.finalize(ctx, a.entity_id, 'REOPEN', c, { viaApproval: true }),
  },
};

/** entity_type is polymorphic, so it is validated here instead of via a foreign key. */
export async function act(ctx, id, action, comment, extra = {}) {
  const a = await repo.getDetail(db, id);
  if (!a) throw notFound('Approval');
  if (a.status !== 'PENDING') throw new AppError(409, `Approval is already ${a.status.toLowerCase().replace(/_/g, ' ')}`);
  if (action !== 'APPROVE' && !comment) throw new AppError(400, 'A comment is required for this action');
  const handler = DISPATCH[a.entity_type]?.[action];
  if (!handler) throw new AppError(409, `Approvals of type ${a.approval_type} cannot be handled automatically`);
  await handler(ctx, a, comment, extra);
  return getApproval(id);
}
