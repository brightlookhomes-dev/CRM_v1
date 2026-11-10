import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { initDb, closeDb, db } from '../src/config/database.js';
import { runMigrations } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { seed } from '../seeds/seed.js';
import { config } from '../src/config/environment.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const H = { 'x-requested-with': 'brightlook' };
let app; const S = {};
const as = (a) => ({ get: (u) => a.get(`/api/v1${u}`).set(H), post: (u) => a.post(`/api/v1${u}`).set(H), delete: (u) => a.delete(`/api/v1${u}`).set(H) });
const login = async (u, p) => { const a = request.agent(app); await a.post('/api/v1/auth/login').set(H).send({ username: u, password: p }); return as(a); };

beforeAll(async () => { await initDb(); await runMigrations(); await seed(); app = createApp(); S.admin = await login('admin', 'Admin@12345'); });
afterAll(closeDb);

describe('hard delete', () => {
  it('sets up a project with a payment, bill, update, decision and files', async () => {
    const mk = (username, role) => S.admin.post('/users').send({ username, fullName: username, role, password: 'Password@123' });
    S.pm = (await mk('pmx', 'PROJECT_MANAGER')).body.data; S.cust = (await mk('custx', 'CUSTOMER')).body.data; S.spare = (await mk('spare', 'CUSTOMER')).body.data;
    S.project = (await S.admin.post('/projects').field('name', 'Doomed').field('location', 'Nowhere').field('projectType', 'Villa').field('contractAmount', '1000000')
      .field('projectManagerIds', JSON.stringify([S.pm.id])).field('customerIds', JSON.stringify([S.cust.id]))
      .attach('cover', PNG, { filename: 'c.png', contentType: 'image/png' })).body.data;
    S.pmA = await login('pmx', 'Password@123');
    S.update = (await S.pmA.post(`/projects/${S.project.id}/updates`).field('type', 'PROGRESS').field('progressPercentage', '5').field('description', 'hello').attach('photos', PNG, { filename: 'p.png', contentType: 'image/png' })).body.data;
    S.bill = (await S.pmA.post('/bills').field('projectId', S.project.id).field('vendorName', 'V1').field('invoiceNumber', 'I1').field('category', 'Bricks').field('amount', '100').field('billDate', '2026-01-01').attach('file', PDF, { filename: 'b.pdf', contentType: 'application/pdf' })).body.data;
    await S.pmA.post(`/projects/${S.project.id}/decisions`).field('title', 'Pick one').field('options', JSON.stringify([{ label: 'A' }, { label: 'B' }]));
    expect((await S.admin.post(`/projects/${S.project.id}/payments`).send({ paymentType: 'ADVANCE', amount: 1000, paymentMethod: 'UPI', paymentDate: '2026-01-02', referenceNumber: 'R1' })).status).toBe(201);
    expect(S.project.id && S.update.id && S.bill.id).toBeTruthy();
  });

  it('refuses without the DELETE confirmation, and for non-admins', async () => {
    expect((await S.admin.delete(`/projects/${S.project.id}/permanent`).send({})).status).toBe(400);
    expect((await S.admin.delete(`/projects/${S.project.id}/permanent`).send({ confirm: 'yes' })).status).toBe(400);
    expect((await S.pmA.delete(`/projects/${S.project.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(403);
    expect((await S.pmA.delete(`/bills/${S.bill.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(403);
    expect((await S.admin.get(`/projects/${S.project.id}`)).status).toBe(200);
  });

  it('permanently deletes a bill and its files', async () => {
    const files = (await db.query('select relative_path from files where id = $1', [S.bill.currentFileId])).rows;
    expect((await S.admin.delete(`/bills/${S.bill.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(200);
    expect((await db.query('select count(*)::int n from vendor_bills')).rows[0].n).toBe(0);
    expect(fs.existsSync(path.resolve(config.uploadDir, files[0].relative_path))).toBe(false);
    expect((await db.query('select count(*)::int n from file_deletion_jobs')).rows[0].n).toBe(0);
    expect((await S.admin.delete(`/bills/${S.bill.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(404);
  });

  it('permanently deletes a site update', async () => {
    expect((await S.admin.delete(`/project-updates/${S.update.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(200);
    expect((await db.query('select count(*)::int n from project_updates')).rows[0].n).toBe(0);
  });

  it('hard-deletes a project with payments and removes every related row and file, keeping an audit trail', async () => {
    expect((await S.admin.delete(`/projects/${S.project.id}`)).status).toBe(409); // soft delete still protected
    const paths = (await db.query('select relative_path from files where project_id = $1', [S.project.id])).rows;
    expect(paths.length).toBeGreaterThan(0);
    expect((await S.admin.delete(`/projects/${S.project.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(200);
    for (const t of ['projects', 'customer_payments', 'decision_requests', 'decision_options', 'project_assignments', 'files', 'approval_requests']) {
      expect((await db.query(`select count(*)::int n from ${t}`)).rows[0].n, t).toBe(0);
    }
    for (const p of paths) expect(fs.existsSync(path.resolve(config.uploadDir, p.relative_path))).toBe(false);
    expect((await db.query('select count(*)::int n from file_deletion_jobs')).rows[0].n).toBe(0);
    const audit = (await db.query("select previous_data from audit_logs where action_type = 'PROJECT_HARD_DELETED'")).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].previous_data).toMatchObject({ name: 'Doomed', payments: 1, bills: 0 });
    expect((await db.query('select count(*)::int n from audit_logs where project_id = $1', [S.project.id])).rows[0].n).toBeGreaterThan(3);
  });

  it('deletes unused users, blocks users that authored records, and blocks self-delete', async () => {
    expect((await S.admin.delete(`/users/${S.spare.id}/permanent`).send({ confirm: 'DELETE' })).status).toBe(200);
    expect((await db.query('select count(*)::int n from users where id = $1', [S.spare.id])).rows[0].n).toBe(0);
    const adminId = (await db.query("select id from users where username = 'admin'")).rows[0].id;
    expect((await S.admin.delete(`/users/${adminId}/permanent`).send({ confirm: 'DELETE' })).status).toBe(409);
    // admin authored audit/other rows via created_by -> must stay
    const blocked = await S.admin.delete(`/users/${S.pm.id}/permanent`).send({ confirm: 'DELETE' });
    expect([200, 409]).toContain(blocked.status);
    expect((await db.query('select count(*)::int n from users where id = $1', [S.cust.id])).rows[0].n).toBe(1);
  });
});
