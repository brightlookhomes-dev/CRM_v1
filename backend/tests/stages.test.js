import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { initDb, closeDb, db } from '../src/config/database.js';
import { runMigrations } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { seed } from '../seeds/seed.js';

const H = { 'x-requested-with': 'brightlook' };
let app; const S = {};
const as = (a) => ({
  get: (u) => a.get(`/api/v1${u}`).set(H), post: (u) => a.post(`/api/v1${u}`).set(H), put: (u) => a.put(`/api/v1${u}`).set(H),
  patch: (u) => a.patch(`/api/v1${u}`).set(H), delete: (u) => a.delete(`/api/v1${u}`).set(H),
});
const login = async (u, p) => { const a = request.agent(app); await a.post('/api/v1/auth/login').set(H).send({ username: u, password: p }); return as(a); };

const PLAN = [
  { name: 'Foundation', weightPercent: 30, durationDays: 10 },
  { name: 'Structure', weightPercent: 50, durationDays: 20 },
  { name: 'Finishing', weightPercent: 20, durationDays: 10 },
];
const create = (extra = {}) => S.admin.post('/projects').field('name', 'Plan Villa').field('location', 'Hyderabad').field('projectType', 'Villa')
  .field('contractAmount', '1000000').field('startDate', '2026-01-01').field('projectManagerIds', JSON.stringify([S.pm.id])).field('customerIds', JSON.stringify([S.cust.id]))
  .field('stages', JSON.stringify(PLAN)).field(...(extra.field ?? ['x', '1']));

beforeAll(async () => {
  await initDb(); await runMigrations(); await seed(); app = createApp();
  S.admin = await login('admin', 'Admin@12345');
  const mk = (username, role) => S.admin.post('/users').send({ username, fullName: username, role, password: 'Password@123' });
  S.pm = (await mk('pm1', 'PROJECT_MANAGER')).body.data; S.pm2 = (await mk('pm2', 'PROJECT_MANAGER')).body.data; S.cust = (await mk('cust1', 'CUSTOMER')).body.data;
  S.pmA = await login('pm1', 'Password@123'); S.pm2A = await login('pm2', 'Password@123'); S.custA = await login('cust1', 'Password@123');
});
afterAll(closeDb);

describe('construction plan at project creation', () => {
  it('rejects plans that do not total 100% or have no start date', async () => {
    const base = () => S.admin.post('/projects').field('name', 'Bad Plan').field('location', 'Here').field('projectType', 'Villa');
    expect((await base().field('startDate', '2026-01-01').field('stages', JSON.stringify([{ name: 'A', weightPercent: 60, durationDays: 5 }, { name: 'B', weightPercent: 30, durationDays: 5 }]))).status).toBe(400);
    expect((await base().field('stages', JSON.stringify(PLAN))).status).toBe(400); // no start date
    expect((await db.query("select count(*)::int n from projects where name = 'Bad Plan'")).rows[0].n).toBe(0);
  });

  it('schedules stages back-to-back from the start date and sets the completion date', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    S.project = res.body.data;
    expect(S.project.expectedCompletionDate).toBe('2026-02-09');
    expect(S.project.overallProgress).toBe(0);
    const { stages } = (await S.admin.get(`/projects/${S.project.id}/stages`)).body.data;
    expect(stages.map((s) => [s.name, s.plannedStart, s.plannedEnd])).toEqual([
      ['Foundation', '2026-01-01', '2026-01-10'], ['Structure', '2026-01-11', '2026-01-30'], ['Finishing', '2026-01-31', '2026-02-09'],
    ]);
    S.stages = stages;
  });

  it('shows the plan to assigned users only', async () => {
    expect((await S.pmA.get(`/projects/${S.project.id}/stages`)).status).toBe(200);
    expect((await S.custA.get(`/projects/${S.project.id}/stages`)).status).toBe(200);
    expect((await S.pm2A.get(`/projects/${S.project.id}/stages`)).status).toBe(403);
    expect((await S.pmA.put(`/projects/${S.project.id}/stages`).send({ stages: PLAN })).status).toBe(403);
  });
});

describe('stage-weighted progress', () => {
  const post = (extra) => {
    let r = S.pmA.post(`/projects/${S.project.id}/updates`).field('type', 'PROGRESS').field('description', 'work done');
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r;
  };

  it('requires a stage and computes overall progress from stage weights', async () => {
    expect((await post({ progressPercentage: '50' })).status).toBe(400); // stage missing
    expect((await post({ progressPercentage: '50', stageId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    const done = await post({ progressPercentage: '100', stageId: S.stages[0].id });
    expect(done.status).toBe(201);
    expect(done.body.data).toMatchObject({ stageName: 'Foundation', overallAfter: 30 });
    const half = await post({ progressPercentage: '50', stageId: S.stages[1].id });
    expect(half.body.data.overallAfter).toBe(55); // 30 + 50% of 50
    const p = (await S.custA.get(`/projects/${S.project.id}`)).body.data;
    expect(p.overallProgress).toBe(55);
    expect(p.status).toBe('IN_PROGRESS');
    const { stages } = (await S.custA.get(`/projects/${S.project.id}/stages`)).body.data;
    expect(stages.map((s) => [s.status, s.completionPercent])).toEqual([['COMPLETED', 100], ['IN_PROGRESS', 50], ['NOT_STARTED', 0]]);
  });

  it('ignores manual progress / completion-date overrides while a plan exists', async () => {
    const r = await S.admin.patch(`/projects/${S.project.id}`).field('overallProgress', '90').field('expectedCompletionDate', '2030-01-01');
    expect(r.status).toBe(200);
    expect(r.body.data.overallProgress).toBe(55);
    expect(r.body.data.expectedCompletionDate).toBe('2026-02-09');
  });
});

describe('editing the timeline', () => {
  it('extending a stage deadline shifts every later stage and the project end date', async () => {
    const before = (await S.admin.get('/audit-logs?action=STAGE_SCHEDULE_CHANGED')).body.meta.total;
    const res = await S.admin.patch(`/projects/${S.project.id}/stages/${S.stages[0].id}/schedule`).send({ plannedEnd: '2026-01-15', reason: 'Monsoon delay' });
    expect(res.status).toBe(200);
    expect(res.body.data.shiftedStages).toBe(2);
    expect(res.body.data.expectedCompletionDate).toBe('2026-02-14');
    expect(res.body.data.stages.map((s) => [s.plannedStart, s.plannedEnd, s.durationDays])).toEqual([
      ['2026-01-01', '2026-01-15', 15], ['2026-01-16', '2026-02-04', 20], ['2026-02-05', '2026-02-14', 10],
    ]);
    expect((await S.admin.get(`/projects/${S.project.id}`)).body.data.expectedCompletionDate).toBe('2026-02-14');
    expect((await S.admin.get('/audit-logs?action=STAGE_SCHEDULE_CHANGED')).body.meta.total).toBe(before + 1);
    const n = (await S.custA.get('/notifications')).body.data;
    expect(n.some((x) => x.notificationType === 'TIMELINE_CHANGED' && x.message.includes('Monsoon delay'))).toBe(true);
  });

  it('supports duration edits, rejects bad dates, and is admin-only', async () => {
    const dur = await S.admin.patch(`/projects/${S.project.id}/stages/${S.stages[2].id}/schedule`).send({ durationDays: 5 });
    expect(dur.body.data.expectedCompletionDate).toBe('2026-02-09');
    expect((await S.admin.patch(`/projects/${S.project.id}/stages/${S.stages[1].id}/schedule`).send({ plannedStart: '2025-12-01' })).status).toBe(400); // before the project starts
    expect((await S.admin.patch(`/projects/${S.project.id}/stages/${S.stages[1].id}/schedule`).send({ plannedEnd: '2026-01-01' })).status).toBe(400);
    expect((await S.admin.patch(`/projects/${S.project.id}/stages/${S.stages[1].id}/schedule`).send({})).status).toBe(400);
    expect((await S.pmA.patch(`/projects/${S.project.id}/stages/${S.stages[1].id}/schedule`).send({ durationDays: 3 })).status).toBe(403);
  });

  it('moving the project start date re-flows all stages', async () => {
    await S.admin.patch(`/projects/${S.project.id}`).field('startDate', '2026-03-01');
    const { stages } = (await S.admin.get(`/projects/${S.project.id}/stages`)).body.data;
    expect(stages[0].plannedStart).toBe('2026-03-01');
    expect(stages[2].plannedEnd).toBe('2026-04-09'); // 15 + 20 + 5 = 40 days from 1 Mar
  });

  it('edits the plan: add an extra stage, re-balance weights, keep existing progress', async () => {
    const { stages } = (await S.admin.get(`/projects/${S.project.id}/stages`)).body.data;
    const bad = await S.admin.put(`/projects/${S.project.id}/stages`).send({ stages: [...stages.map((s) => ({ id: s.id, name: s.name, weightPercent: s.weightPercent, durationDays: s.durationDays })), { name: 'Landscaping', weightPercent: 5, durationDays: 4 }] });
    expect(bad.status).toBe(400); // totals 105%
    const ok = await S.admin.put(`/projects/${S.project.id}/stages`).send({ stages: [
      { id: stages[0].id, name: 'Foundation', weightPercent: 30, durationDays: 15 },
      { id: stages[1].id, name: 'Structure', weightPercent: 45, durationDays: 20 },
      { id: stages[2].id, name: 'Finishing', weightPercent: 20, durationDays: 5 },
      { name: 'Landscaping', weightPercent: 5, durationDays: 4 },
    ] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.stages).toHaveLength(4);
    expect(ok.body.data.stages[0].completionPercent).toBe(100); // progress preserved
    expect(ok.body.data.overallProgress).toBe(52.5); // 30 + 50% of 45
    expect(ok.body.data.stages[3].plannedEnd).toBe('2026-04-13');
    expect((await S.admin.get(`/projects/${S.project.id}`)).body.data.overallProgress).toBe(52.5);
  });
});

describe('overlapping stages', () => {
  const PLAN2 = [
    { name: 'Foundation', weightPercent: 25, durationDays: 10 },
    { name: 'Brickwork', weightPercent: 25, durationDays: 20 },
    { name: 'Plumbing & Electrical', weightPercent: 25, durationDays: 10, startOffsetDays: -10 }, // runs alongside the tail of brickwork
    { name: 'Finishing', weightPercent: 25, durationDays: 5 },
  ];
  const mk = (plan) => S.admin.post('/projects').field('name', 'Overlap Villa').field('location', 'Hyderabad').field('projectType', 'Villa')
    .field('startDate', '2026-01-01').field('projectManagerIds', JSON.stringify([S.pm.id])).field('customerIds', JSON.stringify([S.cust.id])).field('stages', JSON.stringify(plan));

  it('lets a stage start before the previous one ends; completion is the latest stage end', async () => {
    const res = await mk(PLAN2);
    expect(res.status).toBe(201);
    S.ov = res.body.data;
    const { stages } = (await S.admin.get(`/projects/${S.ov.id}/stages`)).body.data;
    S.ovStages = stages;
    expect(stages.map((s) => [s.plannedStart, s.plannedEnd, s.startOffsetDays])).toEqual([
      ['2026-01-01', '2026-01-10', 0], ['2026-01-11', '2026-01-30', 0], ['2026-01-21', '2026-01-30', -10], ['2026-01-31', '2026-02-04', 0],
    ]);
    expect(S.ov.expectedCompletionDate).toBe('2026-02-04');
  });

  it('rejects an overlap that would start before the project does', async () => {
    const bad = await mk([PLAN2[0], { ...PLAN2[1], startOffsetDays: -40 }, PLAN2[2], PLAN2[3]]);
    expect(bad.status).toBe(400);
    expect((await db.query("select count(*)::int n from projects where name = 'Overlap Villa'")).rows[0].n).toBe(1); // only the valid one exists
  });

  it('moving a deadline carries overlapping stages along with it', async () => {
    const res = await S.admin.patch(`/projects/${S.ov.id}/stages/${S.ovStages[1].id}/schedule`).send({ plannedEnd: '2026-02-04', reason: 'Rain' });
    expect(res.status).toBe(200);
    expect(res.body.data.stages.map((s) => [s.plannedStart, s.plannedEnd])).toEqual([
      ['2026-01-01', '2026-01-10'], ['2026-01-11', '2026-02-04'], ['2026-01-26', '2026-02-04'], ['2026-02-05', '2026-02-09'],
    ]);
    expect(res.body.data.expectedCompletionDate).toBe('2026-02-09');
  });

  it('editing a stage start into the previous stage creates an overlap; progress counts every stage by weight', async () => {
    const res = await S.admin.patch(`/projects/${S.ov.id}/stages/${S.ovStages[2].id}/schedule`).send({ plannedStart: '2026-01-20' });
    expect(res.status).toBe(200);
    const stage = res.body.data.stages[2];
    expect(stage.plannedStart).toBe('2026-01-20');
    expect(stage.startOffsetDays).toBe(-16); // 20 Jan vs the day after Brickwork ends (5 Feb)
    const post = (stageId) => S.pmA.post(`/projects/${S.ov.id}/updates`).field('type', 'PROGRESS').field('description', 'done').field('progressPercentage', '100').field('stageId', stageId);
    await post(S.ovStages[0].id);
    const both = await post(S.ovStages[2].id);
    expect(both.body.data.overallAfter).toBe(50); // two parallel 25% stages complete
  });

  it('overlap offsets survive a plan edit', async () => {
    const { stages } = (await S.admin.get(`/projects/${S.ov.id}/stages`)).body.data;
    const keep = stages.map((s) => ({ id: s.id, name: s.name, weightPercent: s.weightPercent, durationDays: s.durationDays, startOffsetDays: s.startOffsetDays }));
    const res = await S.admin.put(`/projects/${S.ov.id}/stages`).send({ stages: keep });
    expect(res.status).toBe(200);
    expect(res.body.data.stages.map((s) => s.startOffsetDays)).toEqual([0, 0, -16, 0]);
  });
});

describe('delays, baseline and tick-off', () => {
  const two = (start) => S.admin.post('/projects').field('name', `Timing ${start}`).field('location', 'Hyderabad').field('projectType', 'Villa').field('startDate', start)
    .field('projectManagerIds', JSON.stringify([S.pm.id])).field('customerIds', JSON.stringify([S.cust.id]))
    .field('stages', JSON.stringify([{ name: 'Stage A', weightPercent: 50, durationDays: 10 }, { name: 'Stage B', weightPercent: 50, durationDays: 10 }]));
  const load = async (id) => (await S.admin.get(`/projects/${id}/stages`)).body.data;

  it('starts on time, with the baseline equal to the plan', async () => {
    const res = await two('2030-01-01');
    S.f = res.body.data;
    const d = await load(S.f.id);
    S.fs = d.stages;
    expect(d.stages.map((x) => x.timing.state)).toEqual(['ON_TRACK', 'ON_TRACK']);
    expect(d.schedule).toMatchObject({ state: 'ON_SCHEDULE', slipDays: 0, overdueStages: 0 });
    expect(d.stages[0].baselineEnd).toBe('2030-01-10');
  });

  it('requires a reason to push a deadline later, then logs the delay and everything it pushed back', async () => {
    const url = `/projects/${S.f.id}/stages/${S.fs[0].id}/schedule`;
    expect((await S.admin.patch(url).send({ plannedEnd: '2030-01-15' })).status).toBe(400);
    expect((await S.admin.patch(url).send({ plannedEnd: '2030-01-15', reason: '  ' })).status).toBe(400);
    const ok = await S.admin.patch(url).send({ plannedEnd: '2030-01-15', reason: 'Material shortage' });
    expect(ok.status).toBe(200);
    const d = ok.body.data;
    expect(d.schedule).toMatchObject({ state: 'DELAYED', slipDays: 5, baselineCompletion: '2030-01-20', plannedCompletion: '2030-01-25' });
    expect(d.stages.map((x) => [x.timing.state, x.timing.days])).toEqual([['EXTENDED', 5], ['EXTENDED', 5]]);
    const log = d.delays.map((x) => [x.stageName, x.kind, x.days, x.causeStageName, x.reason]);
    expect(log).toHaveLength(2);
    expect(log).toContainEqual(['Stage A', 'EXTENDED', 5, null, 'Material shortage']);
    expect(log).toContainEqual(['Stage B', 'SHIFTED', 5, 'Stage A', 'Material shortage']);
    expect((await S.custA.get(`/projects/${S.f.id}/stages`)).body.data.delays).toHaveLength(2); // visible to the customer too
  });

  it('pulling a deadline back needs no reason and clears the delay', async () => {
    const res = await S.admin.patch(`/projects/${S.f.id}/stages/${S.fs[0].id}/schedule`).send({ plannedEnd: '2030-01-10' });
    expect(res.status).toBe(200);
    expect(res.body.data.schedule.state).toBe('ON_SCHEDULE');
    expect(res.body.data.delays).toHaveLength(2); // history is kept
  });

  it('ticking a stage off updates its bar, overall progress and the timing; un-ticking reverses it', async () => {
    const url = `/projects/${S.f.id}/stages/${S.fs[0].id}/complete`;
    expect((await S.pmA.post(url).send({ completed: true })).status).toBe(403);
    expect((await S.admin.post(url).send({ completed: true, completedOn: '2099-01-01' })).status).toBe(400);
    const done = await S.admin.post(url).send({ completed: true });
    expect(done.status).toBe(200);
    expect(done.body.data.stages[0]).toMatchObject({ status: 'COMPLETED', completionPercent: 100 });
    expect(done.body.data.stages[0].timing.state).toBe('COMPLETED_EARLY');
    expect(done.body.data.overallProgress).toBe(50);
    expect((await S.custA.get(`/projects/${S.f.id}`)).body.data.overallProgress).toBe(50);
    expect((await S.custA.get('/notifications')).body.data.some((n) => n.notificationType === 'STAGE_COMPLETED')).toBe(true);
    const undo = await S.admin.post(url).send({ completed: false });
    expect(undo.body.data.stages[0]).toMatchObject({ status: 'NOT_STARTED', completionPercent: 0, actualEnd: null });
    expect(undo.body.data.overallProgress).toBe(0);
  });

  it('shows overdue and completed-late stages as delayed', async () => {
    const q = (await two('2020-01-01')).body.data;
    const d = await load(q.id);
    expect(d.stages[0].timing.state).toBe('OVERDUE');
    expect(d.schedule).toMatchObject({ state: 'DELAYED', overdueStages: 2 });
    const url = `/projects/${q.id}/stages/${d.stages[0].id}/complete`;
    const late = await S.admin.post(url).send({ completed: true, completedOn: '2020-01-14' });
    expect(late.body.data.stages[0].timing).toEqual({ state: 'COMPLETED_LATE', days: 4 });
    expect(late.body.data.schedule.completedLate).toBe(1);
    const onTime = await S.admin.post(url).send({ completed: true, completedOn: '2020-01-10' });
    expect(onTime.body.data.stages[0].timing.state).toBe('COMPLETED_ON_TIME');
    const actions = (await S.admin.get('/audit-logs?limit=100')).body.data.map((a) => a.actionType);
    for (const a of ['STAGE_COMPLETED', 'STAGE_REOPENED', 'STAGE_SCHEDULE_CHANGED']) expect(actions).toContain(a);
  });
});

describe('calendar events (deadlines & extras)', () => {
  it('admin adds, edits and deletes items; PM can read but not write', async () => {
    const c = await S.admin.post(`/projects/${S.project.id}/events`).send({ title: 'Slab casting deadline', eventType: 'DEADLINE', startDate: '2026-03-20', notes: 'Concrete booked' });
    expect(c.status).toBe(201);
    const id = c.body.data.id;
    expect((await S.admin.post(`/projects/${S.project.id}/events`).send({ title: 'Bad', startDate: '2026-03-20', endDate: '2026-03-10' })).status).toBe(400);
    const u = await S.admin.patch(`/projects/${S.project.id}/events/${id}`).send({ startDate: '2026-03-25', title: 'Slab casting (moved)' });
    expect(u.body.data).toMatchObject({ startDate: '2026-03-25', title: 'Slab casting (moved)' });
    expect((await S.pmA.get(`/projects/${S.project.id}/events`)).body.data).toHaveLength(1);
    expect((await S.pmA.post(`/projects/${S.project.id}/events`).send({ title: 'Nope', startDate: '2026-03-01' })).status).toBe(403);
    expect((await S.pm2A.get(`/projects/${S.project.id}/events`)).status).toBe(403);
    expect((await S.admin.delete(`/projects/${S.project.id}/events/${id}`)).status).toBe(200);
    expect((await S.admin.get(`/projects/${S.project.id}/events`)).body.data).toHaveLength(0);
    const actions = (await S.admin.get('/audit-logs?limit=100')).body.data.map((a) => a.actionType);
    for (const a of ['EVENT_CREATED', 'EVENT_UPDATED', 'EVENT_DELETED', 'STAGES_PLAN_CREATED', 'STAGES_PLAN_UPDATED']) expect(actions).toContain(a);
  });

  it('a project with a plan can still be permanently deleted', async () => {
    expect((await S.admin.delete(`/projects/${S.project.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(200);
    expect((await db.query('select count(*)::int n from project_stages where project_id = $1', [S.project.id])).rows[0].n).toBe(0);
    expect((await S.admin.delete(`/projects/${S.ov.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(200);
    expect((await db.query('select count(*)::int n from project_stages where project_id = any($1::uuid[])', [[S.project.id, S.ov.id]])).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int n from project_stage_delays where project_id = $1', [S.f.id])).rows[0].n).toBeGreaterThan(0); // other projects untouched
    expect((await S.admin.delete(`/projects/${S.f.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(200); // delay log is removed with its project
    expect((await db.query('select count(*)::int n from project_stage_delays where project_id = $1', [S.f.id])).rows[0].n).toBe(0);
  });
});
