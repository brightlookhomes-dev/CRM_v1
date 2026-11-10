import { db, withTx } from '../../config/database.js';
import { AppError, notFound } from '../../utils/errors.js';
import { toCamel, pageMeta, paymentSummary } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { saveUploadedFile } from '../../services/fileStorage.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';
import * as repo from './projects.repository.js';
import * as assignments from './assignments.service.js';
import { createInitialStages, reflowFromStart } from '../stages/stages.service.js';

export function shape(row) {
  const { totalReceived, ...rest } = toCamel(row);
  return { ...rest, payment: paymentSummary(row.contract_amount, totalReceived) };
}

export async function listProjects(user, query) {
  const { rows, total } = await repo.list(db, { user, ...query });
  return { data: rows.map(shape), meta: pageMeta(query.page, query.limit, total) };
}

export async function getProject(user, id) {
  await requireProjectAccess(db, user, id);
  const row = await repo.getById(db, id);
  return { ...shape(row), progressHistory: toCamel(await repo.progressHistory(db, id)) };
}

async function applyCover(tx, ctx, projectId, coverFile) {
  if (!coverFile) return undefined;
  const file = await saveUploadedFile(tx, coverFile, { category: 'projects', uploadedBy: ctx.user.id, projectId });
  if (!file.mime_type.startsWith('image/')) throw new AppError(400, 'Cover must be an image');
  return file.id;
}

export async function createProject(ctx, body, coverFile) {
  return withTx(async (tx) => {
    const { projectManagerIds = [], customerIds = [], stages, ...fields } = body;
    const project = await repo.insert(tx, { ...fields, code: await repo.nextCode(tx), createdBy: ctx.user.id });
    const coverId = await applyCover(tx, ctx, project.id, coverFile);
    if (coverId) await repo.update(tx, project.id, { coverImageFileId: coverId }, ctx.user.id);
    await repo.insertProgressHistory(tx, project.id, null, project.overall_progress, ctx.user.id, 'Initial progress');
    await assignments.syncAssignments(tx, ctx, project.id, 'PROJECT_MANAGER', projectManagerIds);
    await assignments.syncAssignments(tx, ctx, project.id, 'CUSTOMER', customerIds);
    if (stages?.length) await createInitialStages(tx, ctx, project, stages);
    await recordAudit(tx, ctx, { action: 'PROJECT_CREATED', module: 'PROJECTS', entityType: 'project', entityId: project.id, projectId: project.id, next: { name: project.name, code: project.project_code, contractAmount: project.contract_amount, status: project.status }, description: `Project ${project.name} created` });
    return shape(await repo.getById(tx, project.id));
  });
}

export async function updateProject(ctx, id, body, coverFile) {
  return withTx(async (tx) => {
    const before = await repo.getById(tx, id);
    if (!before || before.deleted_at) throw notFound('Project');
    const { projectManagerIds, customerIds, stages: ignored, ...fields } = body;
    const stageCount = (await tx.query('select count(*)::int as n from project_stages where project_id = $1', [id])).rows[0].n;
    if (stageCount > 0) { delete fields.overallProgress; delete fields.expectedCompletionDate; } // both are driven by the stage plan
    const coverId = await applyCover(tx, ctx, id, coverFile);
    if (coverId) fields.coverImageFileId = coverId;
    if (fields.status === 'COMPLETED' && !before.actual_completion_date) fields.actualCompletionDate = new Date().toISOString().slice(0, 10);
    await repo.update(tx, id, fields, ctx.user.id);
    if (stageCount > 0 && fields.startDate && fields.startDate !== before.start_date) await reflowFromStart(tx, id, fields.startDate);
    if (fields.overallProgress !== undefined && fields.overallProgress !== before.overall_progress) {
      await repo.insertProgressHistory(tx, id, before.overall_progress, fields.overallProgress, ctx.user.id, 'Updated by admin');
    }
    if (projectManagerIds) await assignments.syncAssignments(tx, ctx, id, 'PROJECT_MANAGER', projectManagerIds);
    if (customerIds) await assignments.syncAssignments(tx, ctx, id, 'CUSTOMER', customerIds);
    const after = await repo.getById(tx, id);
    const pick = (p) => ({ name: p.name, location: p.location, projectType: p.project_type, contractAmount: p.contract_amount, status: p.status, overallProgress: p.overall_progress, startDate: p.start_date, expectedCompletionDate: p.expected_completion_date });
    await recordAudit(tx, ctx, {
      action: fields.status && fields.status !== before.status ? 'PROJECT_STATUS_CHANGED' : 'PROJECT_UPDATED',
      module: 'PROJECTS', entityType: 'project', entityId: id, projectId: id, previous: pick(before), next: pick(after),
      description: `Project ${after.name} updated`,
    });
    return shape(after);
  });
}

export async function deleteProject(ctx, id) {
  return withTx(async (tx) => {
    const project = await repo.getById(tx, id);
    if (!project || project.deleted_at) throw notFound('Project');
    if (await repo.hasProtectedHistory(tx, id)) {
      throw new AppError(409, 'This project has payments or bills and cannot be deleted. Archive it instead.');
    }
    await repo.softDelete(tx, id);
    await recordAudit(tx, ctx, { action: 'PROJECT_DELETED', module: 'PROJECTS', entityType: 'project', entityId: id, projectId: id, previous: { name: project.name, status: project.status }, description: `Project ${project.name} soft-deleted` });
  });
}

export async function addAssignment(ctx, projectId, { userId, assignmentRole }) {
  return withTx(async (tx) => {
    const project = await repo.getById(tx, projectId);
    if (!project || project.deleted_at) throw notFound('Project');
    await assignments.assignUser(tx, ctx, projectId, userId, assignmentRole);
    return toCamel(await assignments.listAssignments(tx, projectId));
  });
}

export const removeAssignment = (ctx, projectId, assignmentId) =>
  withTx((tx) => assignments.unassignUser(tx, ctx, projectId, assignmentId));

export async function getAssignments(user, projectId) {
  await requireProjectAccess(db, user, projectId);
  return toCamel(await assignments.listAssignments(db, projectId));
}
