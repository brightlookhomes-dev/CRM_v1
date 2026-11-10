import { db, withTx } from '../../config/database.js';
import { AppError, forbidden, notFound } from '../../utils/errors.js';
import { toCamel, pageMeta } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify, adminIds, projectUserIds } from '../../services/notification.service.js';
import { saveMany } from '../../services/fileStorage.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';
import * as approvals from '../approvals/approvals.repository.js';
import * as repo from './decisions.repository.js';

const shapeRow = (r) => toCamel(r);

/** Used by POST /projects/:id/decisions and by "Request Approval" site updates (same transaction). */
export async function createDecisionInTx(tx, ctx, project, body, photoFiles = []) {
  if (!project.id) throw new AppError(500, 'Project required');
  if (body.deadline && new Date(body.deadline) <= new Date()) throw new AppError(400, 'Deadline must be in the future');
  const decision = await repo.insert(tx, { ...body, projectId: project.id, requestedBy: ctx.user.id });
  let i = 0;
  for (const option of body.options) await repo.insertOption(tx, decision.id, option, i++);
  const files = await saveMany(tx, photoFiles, { category: 'decisions', uploadedBy: ctx.user.id, projectId: project.id });
  for (const f of files) await repo.linkFile(tx, decision.id, f.id);
  await repo.addHistory(tx, decision.id, null, 'PENDING_CUSTOMER', ctx.user.id, 'Decision requested');
  await recordAudit(tx, ctx, { action: 'DECISION_CREATED', module: 'DECISIONS', entityType: 'decision', entityId: decision.id, projectId: project.id, next: { title: decision.title, options: body.options.map((o) => o.label) }, description: `Decision requested: ${decision.title}` });
  await notify(tx, { recipientIds: await projectUserIds(tx, project.id, 'CUSTOMER'), projectId: project.id, type: 'DECISION_REQUESTED', title: 'Your decision is needed', message: decision.title, entityType: 'decision', entityId: decision.id });
  return decision;
}

export async function createDecision(ctx, projectId, body, photoFiles) {
  return withTx(async (tx) => {
    const project = await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN', 'PROJECT_MANAGER'] });
    return shapeRow(await createDecisionInTx(tx, ctx, project, body, photoFiles));
  });
}

export async function listDecisions(user, projectId, query) {
  await requireProjectAccess(db, user, projectId);
  await repo.expireOverdue(db, projectId);
  const { rows, total } = await repo.listForProject(db, projectId, query);
  return { data: rows.map(shapeRow), meta: pageMeta(query.page, query.limit, total) };
}

export async function getDecision(user, id) {
  const raw = await repo.getRaw(db, id);
  if (!raw) throw notFound('Decision');
  await requireProjectAccess(db, user, raw.project_id);
  await repo.expireOverdue(db, raw.project_id);
  return shapeRow(await repo.getDetail(db, id));
}

export async function getHistory(user, id) {
  const d = await getDecision(user, id);
  return { history: d.history, responses: d.responses };
}

export async function respond(ctx, id, { optionId, comment }, docs) {
  return withTx(async (tx) => {
    const d = await repo.getRaw(tx, id, true);
    if (!d) throw notFound('Decision');
    const project = await requireProjectAccess(tx, ctx.user, d.project_id, { roles: ['CUSTOMER'] });
    if (d.status === 'PENDING_CUSTOMER' && d.deadline && new Date(d.deadline) < new Date()) {
      await repo.setStatus(tx, id, 'EXPIRED');
      await repo.addHistory(tx, id, 'PENDING_CUSTOMER', 'EXPIRED', null, 'Deadline passed');
      throw new AppError(409, 'The deadline for this decision has passed');
    }
    if (d.status !== 'PENDING_CUSTOMER') throw new AppError(409, `This decision is ${d.status.toLowerCase().replace('_', ' ')} and cannot be answered`);
    const option = (await tx.query('select id, label from decision_options where id = $1 and decision_id = $2', [optionId, id])).rows[0];
    if (!option) throw new AppError(400, 'Selected option does not belong to this decision');

    const response = await repo.insertResponse(tx, id, optionId, ctx.user.id, comment);
    const files = await saveMany(tx, docs, { category: 'decisions', uploadedBy: ctx.user.id, projectId: d.project_id });
    for (const f of files) await repo.linkFile(tx, id, f.id, response.id);
    await repo.setStatus(tx, id, 'RESPONDED');
    await repo.addHistory(tx, id, d.status, 'RESPONDED', ctx.user.id, `Selected: ${option.label}${comment ? ` — ${comment}` : ''}`);

    if (d.requires_admin_approval) {
      await approvals.create(tx, { projectId: d.project_id, requesterId: d.requested_by, type: 'DECISION_ESCALATION', entityType: 'decision', entityId: id, title: `Decision: ${d.title}`, summary: `Customer chose "${option.label}"` });
    }
    await recordAudit(tx, ctx, { action: 'DECISION_RESPONDED', module: 'DECISIONS', entityType: 'decision', entityId: id, projectId: d.project_id, previous: { status: d.status }, next: { status: 'RESPONDED', optionId, optionLabel: option.label, comment }, description: `Customer responded to "${d.title}"` });
    const recipients = [d.requested_by, ...(await projectUserIds(tx, d.project_id, 'PROJECT_MANAGER')), ...(await adminIds(tx))];
    await notify(tx, { recipientIds: recipients, projectId: project.id, type: 'DECISION_RESPONDED', title: 'Customer responded to a decision', message: `${d.title}: ${option.label}`, entityType: 'decision', entityId: id });
    return shapeRow(await repo.getDetail(tx, id));
  });
}

/** Final handling after a customer response: APPROVE | REJECT | REOPEN (ask the customer again). */
export async function finalize(ctx, id, action, comment, { viaApproval = false } = {}) {
  const next = { APPROVE: 'APPROVED', REJECT: 'REJECTED', REOPEN: 'PENDING_CUSTOMER' }[action];
  if (!next) throw new AppError(400, 'Invalid action');
  return withTx(async (tx) => {
    const d = await repo.getRaw(tx, id, true);
    if (!d) throw notFound('Decision');
    await requireProjectAccess(tx, ctx.user, d.project_id, { roles: ['ADMIN', 'PROJECT_MANAGER'] });
    if (d.status !== 'RESPONDED') throw new AppError(409, 'Only responded decisions can be finalised');
    if (d.requires_admin_approval && ctx.user.role !== 'ADMIN' && !viaApproval) throw forbidden('This decision requires admin approval');
    await repo.setStatus(tx, id, next);
    await repo.addHistory(tx, id, d.status, next, ctx.user.id, comment);
    await approvals.transitionForEntity(tx, { entityType: 'decision', entityId: id, status: { APPROVE: 'APPROVED', REJECT: 'REJECTED', REOPEN: 'CLARIFICATION_REQUIRED' }[action], actorId: ctx.user.id, action, comment });
    await recordAudit(tx, ctx, { action: `DECISION_${next === 'PENDING_CUSTOMER' ? 'REOPENED' : next}`, module: 'DECISIONS', entityType: 'decision', entityId: id, projectId: d.project_id, previous: { status: d.status }, next: { status: next, comment }, description: `Decision "${d.title}" ${next.toLowerCase()}` });
    await notify(tx, { recipientIds: await projectUserIds(tx, d.project_id, 'CUSTOMER'), projectId: d.project_id, type: `DECISION_${next}`, title: next === 'PENDING_CUSTOMER' ? 'Please review your decision again' : `Your decision was ${next.toLowerCase()}`, message: d.title, entityType: 'decision', entityId: id });
    return shapeRow(await repo.getDetail(tx, id));
  });
}

export async function cancel(ctx, id, comment) {
  return withTx(async (tx) => {
    const d = await repo.getRaw(tx, id, true);
    if (!d) throw notFound('Decision');
    await requireProjectAccess(tx, ctx.user, d.project_id, { roles: ['ADMIN', 'PROJECT_MANAGER'] });
    if (!['PENDING_CUSTOMER', 'DRAFT'].includes(d.status)) throw new AppError(409, 'Only open decisions can be cancelled');
    await repo.setStatus(tx, id, 'CANCELLED');
    await repo.addHistory(tx, id, d.status, 'CANCELLED', ctx.user.id, comment);
    await recordAudit(tx, ctx, { action: 'DECISION_CANCELLED', module: 'DECISIONS', entityType: 'decision', entityId: id, projectId: d.project_id, previous: { status: d.status }, next: { status: 'CANCELLED' }, description: `Decision "${d.title}" cancelled` });
    return shapeRow(await repo.getDetail(tx, id));
  });
}
