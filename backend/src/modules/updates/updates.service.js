import { db, withTx } from '../../config/database.js';
import { AppError, forbidden, notFound } from '../../utils/errors.js';
import { toCamel, pageMeta } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify, adminIds, projectUserIds } from '../../services/notification.service.js';
import { saveMany } from '../../services/fileStorage.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';
import * as projectsRepo from '../projects/projects.repository.js';
import { createDecisionInTx } from '../decisions/decisions.service.js';
import * as stagesSvc from '../stages/stages.service.js';
import * as repo from './updates.repository.js';

export async function createUpdate(ctx, projectId, body, files = {}) {
  const photos = files.photos ?? [];
  const documents = files.documents ?? [];
  return withTx(async (tx) => {
    const project = await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN', 'PROJECT_MANAGER'] });
    if (['CANCELLED', 'ARCHIVED'].includes(project.status)) throw new AppError(409, `Cannot post updates to a ${project.status.toLowerCase()} project`);

    let decision = null;
    if (body.type === 'APPROVAL_REQUEST') {
      decision = await createDecisionInTx(tx, ctx, project, {
        title: body.title, description: body.description, category: body.decisionCategory, details: body.details,
        deadline: body.deadline, requiresAdminApproval: body.requiresAdminApproval, options: body.options,
      }, photos);
    }
    let stageResult = null;
    if (body.type === 'PROGRESS') {
      const stageCount = (await tx.query('select count(*)::int as n from project_stages where project_id = $1', [projectId])).rows[0].n;
      if (stageCount > 0) {
        if (!body.stageId) throw new AppError(400, 'Select the construction stage you are updating');
        stageResult = await stagesSvc.applyStageProgress(tx, projectId, body.stageId, body.progressPercentage);
      }
    }
    const update = await repo.insert(tx, { ...body, projectId, createdBy: ctx.user.id, decisionRequestId: decision?.id, stageId: stageResult ? body.stageId : undefined, overallAfter: stageResult?.overall });

    if (decision === null) {
      const saved = await saveMany(tx, photos, { category: 'project-updates', uploadedBy: ctx.user.id, projectId });
      for (const f of saved) await repo.linkFile(tx, update.id, f.id, 'PHOTO');
    }
    const docs = await saveMany(tx, documents, { category: 'project-updates', uploadedBy: ctx.user.id, projectId });
    for (const f of docs) await repo.linkFile(tx, update.id, f.id, 'DOCUMENT');

    if (body.type === 'PROGRESS') {
      const previous = project.overall_progress;
      const target = stageResult ? stageResult.overall : body.progressPercentage;
      if (target !== previous) {
        const patch = { overallProgress: target };
        if (['PLANNED', 'NOT_STARTED'].includes(project.status) && target > 0) patch.status = 'IN_PROGRESS';
        await projectsRepo.update(tx, projectId, patch, ctx.user.id);
        await projectsRepo.insertProgressHistory(tx, projectId, previous, target, ctx.user.id, body.description);
        await recordAudit(tx, ctx, { action: 'PROJECT_PROGRESS_CHANGED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId, previous: { overallProgress: previous }, next: { overallProgress: target }, description: `Progress ${previous}% → ${target}%` });
      }
    }

    const label = { PROGRESS: 'Progress update', MATERIAL: 'Material update', GENERAL: 'Site update', APPROVAL_REQUEST: 'Approval request' }[body.type];
    await recordAudit(tx, ctx, { action: `UPDATE_${body.type}_CREATED`, module: 'UPDATES', entityType: 'project_update', entityId: update.id, projectId, next: { type: body.type, title: body.title, progress: body.progressPercentage, photos: photos.length, documents: documents.length }, description: `${label} posted` });
    if (body.type !== 'APPROVAL_REQUEST') {
      await notify(tx, { recipientIds: await projectUserIds(tx, projectId, 'CUSTOMER'), projectId, type: 'PROJECT_UPDATE', title: `${label} on ${project.name}`, message: body.title ?? body.description?.slice(0, 120), entityType: 'project_update', entityId: update.id });
    }
    await notify(tx, { recipientIds: await adminIds(tx), projectId, type: 'PROJECT_UPDATE', title: `${label} on ${project.name}`, message: `By ${ctx.user.fullName}`, entityType: 'project_update', entityId: update.id, excludeUserId: ctx.user.id });
    return toCamel(await repo.getById(tx, update.id));
  });
}

export async function listUpdates(user, projectId, query) {
  await requireProjectAccess(db, user, projectId);
  const { rows, total } = await repo.list(db, projectId, query);
  return { data: toCamel(rows), meta: pageMeta(query.page, query.limit, total) };
}

export async function getUpdate(user, id) {
  const row = await repo.getById(db, id);
  if (!row) throw notFound('Update');
  await requireProjectAccess(db, user, row.project_id);
  return toCamel(row);
}

export async function editUpdate(ctx, id, body) {
  return withTx(async (tx) => {
    const before = await repo.getById(tx, id);
    if (!before) throw notFound('Update');
    await requireProjectAccess(tx, ctx.user, before.project_id, { roles: ['ADMIN', 'PROJECT_MANAGER'] });
    if (ctx.user.role !== 'ADMIN' && before.created_by !== ctx.user.id) throw forbidden('You can only edit your own updates');
    await repo.updateText(tx, id, body);
    const after = await repo.getById(tx, id);
    await recordAudit(tx, ctx, { action: 'UPDATE_MODIFIED', module: 'UPDATES', entityType: 'project_update', entityId: id, projectId: before.project_id, previous: { title: before.title, description: before.description }, next: { title: after.title, description: after.description }, description: 'Project update modified' });
    return toCamel(after);
  });
}
