import { db, withTx } from '../../config/database.js';
import { AppError, notFound } from '../../utils/errors.js';
import { toCamel, round2 } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify, projectUserIds } from '../../services/notification.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';
import * as projectsRepo from '../projects/projects.repository.js';

export const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const localToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/**
 * Stage i starts (previous stage end + 1 day) + startOffsetDays: 0 = right after, negative = overlaps the previous
 * stage, positive = a gap. The first stage always starts on the project start date. `floor` is the earliest allowed start.
 */
export function schedule(startDate, items, floor = startDate) {
  let cursor = startDate;
  return items.map((it, i) => {
    const startOffsetDays = i === 0 ? 0 : Number(it.startOffsetDays ?? 0);
    const plannedStart = addDays(cursor, startOffsetDays);
    if (plannedStart < floor) throw new AppError(400, `Stage "${it.name ?? i + 1}" would start before the project start date`);
    const plannedEnd = addDays(plannedStart, it.durationDays - 1);
    cursor = addDays(plannedEnd, 1);
    return { ...it, startOffsetDays, plannedStart, plannedEnd };
  });
}

/** Overall progress = Σ stage weight × stage completion. Weights total 100%, so the result is 0–100. */
export const overallFrom = (stages) =>
  round2(stages.reduce((sum, s) => sum + (Number(s.weight_percent) * Number(s.completion_percent)) / 100, 0));

/** On time vs delayed for one stage, relative to its (current) deadline and its baseline. */
export function stageTiming(s, today) {
  if (s.status === 'COMPLETED' && s.actual_end) {
    const late = diffDays(s.planned_end, s.actual_end);
    if (late > 0) return { state: 'COMPLETED_LATE', days: late };
    return late < 0 ? { state: 'COMPLETED_EARLY', days: -late } : { state: 'COMPLETED_ON_TIME', days: 0 };
  }
  if (today > s.planned_end) return { state: 'OVERDUE', days: diffDays(s.planned_end, today) };
  if (s.baseline_end && s.planned_end > s.baseline_end) return { state: 'EXTENDED', days: diffDays(s.baseline_end, s.planned_end) };
  return { state: 'ON_TRACK', days: 0 };
}

export const listRaw = async (exec, projectId) =>
  (await exec.query('select * from project_stages where project_id = $1 order by sort_order, created_at', [projectId])).rows;

export function validatePlan(items) {
  const total = round2(items.reduce((a, s) => a + Number(s.weightPercent), 0));
  if (items.length && Math.abs(total - 100) > 0.01) throw new AppError(400, `Stage percentages must add up to 100% (currently ${total}%)`);
}

const summarise = (rows) => rows.map((s) => ({ name: s.name, weight: Number(s.weight_percent), days: s.duration_days, offset: s.start_offset_days, start: s.planned_start, end: s.planned_end }));
const maxOf = (rows, key) => rows.reduce((m, s) => (s[key] && s[key] > m ? s[key] : m), '');

/** Stages + computed timing + delay log + schedule summary: the one shape every stage endpoint returns. */
export async function describeStages(exec, projectId) {
  const rows = await listRaw(exec, projectId);
  const today = localToday();
  const timings = rows.map((r) => stageTiming(r, today));
  const delays = (await exec.query(
    `select d.*, u.full_name as created_by_name from project_stage_delays d left join users u on u.id = d.created_by
      where d.project_id = $1 order by d.created_at desc, d.id`, [projectId])).rows;
  const plannedCompletion = maxOf(rows, 'planned_end');
  const baselineCompletion = maxOf(rows.map((r) => ({ ...r, baseline_end: r.baseline_end ?? r.planned_end })), 'baseline_end');
  const slipDays = rows.length ? Math.max(0, diffDays(baselineCompletion, plannedCompletion)) : 0;
  const overdueStages = timings.filter((t) => t.state === 'OVERDUE').length;
  return {
    stages: rows.map((r, i) => ({ ...toCamel(r), timing: timings[i] })),
    delays: toCamel(delays),
    overallProgress: overallFrom(rows),
    schedule: {
      state: slipDays > 0 || overdueStages > 0 ? 'DELAYED' : 'ON_SCHEDULE',
      slipDays, overdueStages, completedLate: timings.filter((t) => t.state === 'COMPLETED_LATE').length,
      baselineCompletion: baselineCompletion || null, plannedCompletion: plannedCompletion || null,
    },
  };
}

async function setProjectProgress(tx, ctx, project, overall, note) {
  const patch = {};
  if (Number(project.overall_progress) !== overall) patch.overallProgress = overall;
  if (['PLANNED', 'NOT_STARTED'].includes(project.status) && overall > 0) patch.status = 'IN_PROGRESS';
  if (Object.keys(patch).length) await projectsRepo.update(tx, project.id, patch, ctx.user.id);
  if (patch.overallProgress !== undefined) await projectsRepo.insertProgressHistory(tx, project.id, project.overall_progress, overall, ctx.user.id, note);
}

/** Project completion = the latest stage end (stages may overlap, so it is not necessarily the last one). */
async function syncCompletionDate(tx, projectId) {
  await tx.query(
    `update projects set expected_completion_date = (select max(planned_end) from project_stages where project_id = $1), updated_at = now()
      where id = $1 and exists (select 1 from project_stages where project_id = $1)`, [projectId]);
}

export async function listStages(user, projectId) {
  await requireProjectAccess(db, user, projectId);
  return describeStages(db, projectId);
}

const insertStage = (tx, projectId, s, order) => tx.query(
  `insert into project_stages (project_id, name, weight_percent, duration_days, sort_order, planned_start, planned_end, start_offset_days, baseline_start, baseline_end)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$6,$7)`, [projectId, s.name, s.weightPercent, s.durationDays, order, s.plannedStart, s.plannedEnd, s.startOffsetDays]);

/** Used during project creation (inside its transaction). */
export async function createInitialStages(tx, ctx, project, items) {
  validatePlan(items);
  if (!project.start_date) throw new AppError(400, 'Set a project start date to schedule the construction stages');
  const planned = schedule(project.start_date, items);
  let i = 0;
  for (const s of planned) await insertStage(tx, project.id, s, i++);
  await tx.query('update projects set overall_progress = 0 where id = $1', [project.id]);
  await syncCompletionDate(tx, project.id);
  await recordAudit(tx, ctx, { action: 'STAGES_PLAN_CREATED', module: 'PROJECTS', entityType: 'project', entityId: project.id, projectId: project.id,
    next: { stages: planned.map((s) => ({ name: s.name, weight: s.weightPercent, days: s.durationDays, offset: s.startOffsetDays, start: s.plannedStart, end: s.plannedEnd })) }, description: `Construction plan created with ${planned.length} stages` });
}

/** Replace the whole plan (add / remove / reorder / edit stages). Existing stages keep their progress; the baseline is reset. */
export async function replaceStages(ctx, projectId, items) {
  validatePlan(items);
  return withTx(async (tx) => {
    const project = (await tx.query('select * from projects where id = $1 and deleted_at is null for update', [projectId])).rows[0];
    if (!project) throw notFound('Project');
    if (items.length && !project.start_date) throw new AppError(400, 'Set a project start date first');
    const before = await listRaw(tx, projectId);
    const known = new Set(before.map((s) => s.id));
    if (items.some((s) => s.id && !known.has(s.id))) throw new AppError(400, 'Unknown stage in plan');

    const planned = items.length ? schedule(project.start_date, items) : [];
    const keep = new Set(planned.filter((s) => s.id).map((s) => s.id));
    const removed = before.filter((s) => !keep.has(s.id)).map((s) => s.id);
    if (removed.length) await tx.query('delete from project_stages where id = any($1::uuid[])', [removed]);
    let i = 0;
    for (const s of planned) {
      if (s.id) {
        await tx.query(
          `update project_stages set name=$2, weight_percent=$3, duration_days=$4, sort_order=$5, planned_start=$6, planned_end=$7, start_offset_days=$8,
             baseline_start=$6, baseline_end=$7, updated_at=now() where id=$1`,
          [s.id, s.name, s.weightPercent, s.durationDays, i++, s.plannedStart, s.plannedEnd, s.startOffsetDays]);
      } else {
        await insertStage(tx, projectId, s, i++);
      }
    }
    const after = await listRaw(tx, projectId);
    await syncCompletionDate(tx, projectId);
    if (after.length) await setProjectProgress(tx, ctx, project, overallFrom(after), 'Construction plan changed');
    await recordAudit(tx, ctx, { action: 'STAGES_PLAN_UPDATED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId,
      previous: { stages: summarise(before) }, next: { stages: summarise(after) }, description: 'Construction plan updated' });
    return describeStages(tx, projectId);
  });
}

/**
 * Change one stage's dates. Pushing a deadline later is a delay and needs a reason (it is logged, together with every
 * later stage it pushes back). Later stages shift to stay in sequence, so the whole timeline and completion date move.
 */
export async function rescheduleStage(ctx, projectId, stageId, { plannedStart, plannedEnd, durationDays, reason }) {
  return withTx(async (tx) => {
    const project = (await tx.query('select * from projects where id = $1 and deleted_at is null for update', [projectId])).rows[0];
    if (!project) throw notFound('Project');
    const stages = await listRaw(tx, projectId);
    const idx = stages.findIndex((s) => s.id === stageId);
    if (idx < 0) throw notFound('Stage');
    const target = stages[idx];

    const start = plannedStart ?? target.planned_start;
    let offset = target.start_offset_days;
    if (idx > 0) {
      if (start < project.start_date) throw new AppError(400, 'A stage cannot start before the project start date');
      offset = diffDays(addDays(stages[idx - 1].planned_end, 1), start); // negative = overlaps the previous stage
    }
    let duration = durationDays ?? target.duration_days;
    if (plannedEnd) {
      duration = diffDays(start, plannedEnd) + 1;
      if (duration < 1) throw new AppError(400, 'End date cannot be before the start date');
    }

    const floor = idx === 0 ? start : project.start_date;
    const tail = schedule(start, [{ id: target.id, name: target.name, durationDays: duration, startOffsetDays: 0 },
      ...stages.slice(idx + 1).map((s) => ({ id: s.id, name: s.name, durationDays: s.duration_days, startOffsetDays: s.start_offset_days }))], floor);
    const delayDays = diffDays(target.planned_end, tail[0].plannedEnd);
    if (delayDays > 0 && !reason?.trim()) throw new AppError(400, 'Give a reason for the delay: the deadline is being pushed later');

    const before = summarise(stages);
    for (const t of tail) {
      await tx.query('update project_stages set planned_start=$2, planned_end=$3, duration_days=$4, updated_at=now() where id=$1', [t.id, t.plannedStart, t.plannedEnd, t.durationDays]);
    }
    if (idx > 0) await tx.query('update project_stages set start_offset_days = $2 where id = $1', [target.id, offset]);
    const after = await listRaw(tx, projectId);
    if (idx === 0 && plannedStart) await tx.query('update projects set start_date = $2 where id = $1', [projectId, plannedStart]);
    await syncCompletionDate(tx, projectId);

    if (delayDays > 0) {
      const insertDelay = (row, kind, days, prevEnd, newEnd) => tx.query(
        `insert into project_stage_delays (project_id, stage_id, stage_name, cause_stage_id, cause_stage_name, kind, days, previous_end, new_end, reason, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [projectId, row.id, row.name, kind === 'SHIFTED' ? target.id : null, kind === 'SHIFTED' ? target.name : null, kind, days, prevEnd, newEnd, reason.trim(), ctx.user.id]);
      await insertDelay(target, 'EXTENDED', delayDays, target.planned_end, after[idx].planned_end);
      for (let i = idx + 1; i < after.length; i += 1) {
        const d = diffDays(stages[i].planned_end, after[i].planned_end);
        if (d > 0) await insertDelay(after[i], 'SHIFTED', d, stages[i].planned_end, after[i].planned_end);
      }
    }
    const completion = maxOf(after, 'planned_end');
    const shifted = after.filter((st, i) => i > idx && st.planned_start !== stages[i].planned_start).length;
    await recordAudit(tx, ctx, { action: 'STAGE_SCHEDULE_CHANGED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId,
      previous: { stages: before }, next: { stages: summarise(after), reason, delayDays }, description: `Stage "${target.name}" rescheduled${delayDays > 0 ? ` (delayed ${delayDays} day${delayDays > 1 ? 's' : ''})` : ''}${shifted ? `; ${shifted} later stage(s) shifted` : ''}` });
    const recipients = [...(await projectUserIds(tx, projectId, 'PROJECT_MANAGER')), ...(await projectUserIds(tx, projectId, 'CUSTOMER'))];
    await notify(tx, { recipientIds: recipients, projectId, type: 'TIMELINE_CHANGED', title: `Timeline updated for ${project.name}`,
      message: `${target.name} now ends ${after[idx].planned_end}. Expected completion: ${completion}.${reason ? ` Reason: ${reason}` : ''}`, entityType: 'project', entityId: projectId });
    return { ...(await describeStages(tx, projectId)), shiftedStages: shifted, expectedCompletionDate: completion };
  });
}

/** Tick a stage off (or re-open it). Updates stage progress, overall progress and the on-time/late status. */
export async function setStageCompleted(ctx, projectId, stageId, { completed, completedOn }) {
  return withTx(async (tx) => {
    const project = (await tx.query('select * from projects where id = $1 and deleted_at is null for update', [projectId])).rows[0];
    if (!project) throw notFound('Project');
    const stages = await listRaw(tx, projectId);
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) throw notFound('Stage');
    const today = localToday();
    const on = completedOn ?? today;
    if (completed && on > today) throw new AppError(400, 'Completion date cannot be in the future');

    if (completed) {
      await tx.query(
        `update project_stages set completion_percent = 100, status = 'COMPLETED', actual_end = $2::date,
           actual_start = coalesce(actual_start, least(planned_start, $2::date)), updated_at = now() where id = $1`, [stageId, on]);
      stage.completion_percent = 100;
    } else {
      await tx.query(`update project_stages set completion_percent = 0, status = 'NOT_STARTED', actual_end = null, actual_start = null, updated_at = now() where id = $1`, [stageId]);
      stage.completion_percent = 0;
    }
    const overall = overallFrom(stages);
    await setProjectProgress(tx, ctx, project, overall, completed ? `Stage completed: ${stage.name}` : `Stage re-opened: ${stage.name}`);
    const late = completed ? diffDays(stage.planned_end, on) : 0;
    await recordAudit(tx, ctx, { action: completed ? 'STAGE_COMPLETED' : 'STAGE_REOPENED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId,
      previous: { stage: stage.name, status: stage.status, completion: Number(stage.completion_percent === 100 && !completed ? 100 : 0) }, next: { stage: stage.name, completedOn: completed ? on : null, plannedEnd: stage.planned_end, daysLate: late, overallProgress: overall },
      description: completed ? `Stage "${stage.name}" completed${late > 0 ? ` ${late} day(s) late` : late < 0 ? ` ${-late} day(s) early` : ' on time'}` : `Stage "${stage.name}" re-opened` });
    if (completed) {
      const recipients = [...(await projectUserIds(tx, projectId, 'PROJECT_MANAGER')), ...(await projectUserIds(tx, projectId, 'CUSTOMER'))];
      await notify(tx, { recipientIds: recipients, projectId, type: 'STAGE_COMPLETED', title: `${stage.name} completed`,
        message: `${project.name} is now ${overall}% complete${late > 0 ? ` (this stage finished ${late} day(s) late)` : late < 0 ? ` (${-late} day(s) ahead of plan)` : ' (on time)'}.`, entityType: 'project', entityId: projectId });
    }
    return describeStages(tx, projectId);
  });
}

/** Re-flow every stage when the project start date changes. */
export async function reflowFromStart(tx, projectId, startDate) {
  const rows = await listRaw(tx, projectId);
  if (!rows.length) return;
  for (const t of schedule(startDate, rows.map((r) => ({ id: r.id, name: r.name, durationDays: r.duration_days, startOffsetDays: r.start_offset_days })))) {
    await tx.query('update project_stages set planned_start=$2, planned_end=$3, baseline_start=$2, baseline_end=$3, updated_at=now() where id=$1', [t.id, t.plannedStart, t.plannedEnd]);
  }
  await syncCompletionDate(tx, projectId);
}

/** PM progress update against a stage: stores the stage's completion and returns the new overall progress. */
export async function applyStageProgress(tx, projectId, stageId, completion) {
  const stages = await listRaw(tx, projectId);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) throw new AppError(400, 'Selected stage does not belong to this project');
  const status = completion >= 100 ? 'COMPLETED' : completion > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
  const today = localToday();
  await tx.query(
    `update project_stages set completion_percent = $2, status = $3::text,
       actual_start = case when $3::text <> 'NOT_STARTED' then coalesce(actual_start, $4::date) else actual_start end,
       actual_end = case when $3::text = 'COMPLETED' then $4::date else null end, updated_at = now() where id = $1`,
    [stageId, completion, status, today]);
  stage.completion_percent = completion;
  return { overall: overallFrom(stages), stage };
}

// ── Calendar events (deadlines, meetings, deliveries…) ──────────────────────────────────────────
export async function listEvents(user, projectId) {
  await requireProjectAccess(db, user, projectId);
  const { rows } = await db.query('select * from project_events where project_id = $1 order by start_date, created_at', [projectId]);
  return toCamel(rows);
}

export async function createEvent(ctx, projectId, body) {
  return withTx(async (tx) => {
    await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN'] });
    const { rows } = await tx.query(
      `insert into project_events (project_id, title, event_type, start_date, end_date, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [projectId, body.title, body.eventType, body.startDate, body.endDate ?? null, body.notes ?? null, ctx.user.id]);
    await recordAudit(tx, ctx, { action: 'EVENT_CREATED', module: 'PROJECTS', entityType: 'project_event', entityId: rows[0].id, projectId, next: body, description: `Calendar item added: ${body.title}` });
    return toCamel(rows[0]);
  });
}

export async function updateEvent(ctx, projectId, eventId, body) {
  return withTx(async (tx) => {
    await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN'] });
    const before = (await tx.query('select * from project_events where id = $1 and project_id = $2 for update', [eventId, projectId])).rows[0];
    if (!before) throw notFound('Event');
    const next = {
      title: body.title ?? before.title, event_type: body.eventType ?? before.event_type, start_date: body.startDate ?? before.start_date,
      end_date: body.endDate === undefined ? before.end_date : body.endDate, notes: body.notes === undefined ? before.notes : body.notes,
    };
    if (next.end_date && next.end_date < next.start_date) throw new AppError(400, 'End date cannot be before the start date');
    const { rows } = await tx.query(
      `update project_events set title=$2, event_type=$3, start_date=$4, end_date=$5, notes=$6, updated_at=now() where id=$1 returning *`,
      [eventId, next.title, next.event_type, next.start_date, next.end_date, next.notes]);
    await recordAudit(tx, ctx, { action: 'EVENT_UPDATED', module: 'PROJECTS', entityType: 'project_event', entityId: eventId, projectId,
      previous: { title: before.title, startDate: before.start_date, endDate: before.end_date }, next: { title: next.title, startDate: next.start_date, endDate: next.end_date }, description: `Calendar item changed: ${next.title}` });
    return toCamel(rows[0]);
  });
}

export async function deleteEvent(ctx, projectId, eventId) {
  return withTx(async (tx) => {
    await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN'] });
    const { rows } = await tx.query('delete from project_events where id = $1 and project_id = $2 returning *', [eventId, projectId]);
    if (!rows[0]) throw notFound('Event');
    await recordAudit(tx, ctx, { action: 'EVENT_DELETED', module: 'PROJECTS', entityType: 'project_event', entityId: eventId, projectId, previous: { title: rows[0].title, startDate: rows[0].start_date }, description: `Calendar item removed: ${rows[0].title}` });
  });
}
