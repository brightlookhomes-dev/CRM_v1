import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';
import { initDb, closeDb, db } from '../src/config/database.js';
import { runMigrations } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { seed } from '../seeds/seed.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const H = { 'x-requested-with': 'brightlook' };

let app;
const S = {}; // shared state across ordered tests

const login = async (username, password) => {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set(H).send({ username, password });
  return { agent, res };
};
const as = (agent) => ({
  get: (url) => agent.get(`/api/v1${url}`).set(H),
  post: (url) => agent.post(`/api/v1${url}`).set(H),
  patch: (url) => agent.patch(`/api/v1${url}`).set(H),
  delete: (url) => agent.delete(`/api/v1${url}`).set(H),
});

beforeAll(async () => {
  await initDb();
  await runMigrations();
  await seed();
  app = createApp();
});
afterAll(closeDb);

describe('authentication', () => {
  it('rejects bad credentials and records the failure', async () => {
    const { res } = await login('admin', 'wrong-password');
    expect(res.status).toBe(401);
    const { rows } = await db.query("select 1 from audit_logs where action_type = 'LOGIN_FAILED'");
    expect(rows.length).toBe(1);
  });

  it('logs in, sets HttpOnly cookies and never leaks the password hash', async () => {
    const { agent, res } = await login('admin', 'Admin@12345');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].join(';')).toMatch(/HttpOnly/);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    S.admin = as(agent);
    const me = await S.admin.get('/auth/me');
    expect(me.body.data.user.role).toBe('ADMIN');
  });

  it('blocks state-changing requests without the CSRF header and invalid JWTs', async () => {
    const noHeader = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'Admin@12345' });
    expect(noHeader.status).toBe(403);
    const bad = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-token');
    expect(bad.status).toBe(401);
    const forged = jwt.sign({ role: 'ADMIN' }, 'other-secret', { subject: '00000000-0000-0000-0000-000000000000' });
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });
});

describe('Workflow 1: admin creates users and project', () => {
  it('creates PMs and customers; rejects duplicate usernames', async () => {
    const mk = (username, fullName, role) => S.admin.post('/users').send({ username, fullName, role, password: 'Password@123', email: `${username}@test.in` });
    S.pm = (await mk('pm1', 'Mahendar', 'PROJECT_MANAGER')).body.data;
    S.pm2 = (await mk('pm2', 'Other PM', 'PROJECT_MANAGER')).body.data;
    S.cust = (await mk('cust1', 'Ravi Kumar', 'CUSTOMER')).body.data;
    S.cust2 = (await mk('cust2', 'Other Customer', 'CUSTOMER')).body.data;
    expect([S.pm, S.pm2, S.cust, S.cust2].every((u) => u?.id)).toBe(true);
    const dup = await mk('PM1', 'Dup', 'PROJECT_MANAGER');
    expect(dup.status).toBe(409);
  });

  it('creates a project with a cover image and assignments', async () => {
    const res = await S.admin.post('/projects')
      .field('name', 'Sunrise Villa').field('location', 'Hyderabad').field('projectType', 'Villa')
      .field('contractAmount', '5000000').field('startDate', '2026-01-01').field('expectedCompletionDate', '2026-12-31')
      .field('projectManagerIds', JSON.stringify([S.pm.id])).field('customerIds', JSON.stringify([S.cust.id]))
      .attach('cover', PNG, { filename: 'cover.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    S.project = res.body.data;
    expect(S.project.coverImageFileId).toBeTruthy();
    expect(S.project.projectManagers[0].id).toBe(S.pm.id);
    expect(S.project.customers[0].id).toBe(S.cust.id);
    expect(S.project.payment.paymentProgress).toBe(0);
  });

  it('rejects a disguised non-image upload (content sniffing)', async () => {
    const res = await S.admin.post('/projects').field('name', 'Bad').field('location', 'X1').field('projectType', 'Villa')
      .attach('cover', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    const { rows } = await db.query("select count(*)::int n from projects where name = 'Bad'");
    expect(rows[0].n).toBe(0); // transaction rolled back
  });
});

describe('project visibility (assignment-based authorization)', () => {
  it('shows the project to its PM and customer only', async () => {
    S.pmA = as((await login('pm1', 'Password@123')).agent);
    S.pm2A = as((await login('pm2', 'Password@123')).agent);
    S.custA = as((await login('cust1', 'Password@123')).agent);
    S.cust2A = as((await login('cust2', 'Password@123')).agent);
    expect((await S.pmA.get('/projects')).body.data.map((p) => p.id)).toEqual([S.project.id]);
    expect((await S.custA.get('/projects')).body.data.length).toBe(1);
    expect((await S.pm2A.get('/projects')).body.data.length).toBe(0);
    expect((await S.pm2A.get(`/projects/${S.project.id}`)).status).toBe(403);
    expect((await S.cust2A.get(`/projects/${S.project.id}`)).status).toBe(403);
    expect((await S.cust2A.get(`/projects/${S.project.id}/updates`)).status).toBe(403);
  });

  it('blocks role escalation on admin APIs', async () => {
    expect((await S.custA.get('/users')).status).toBe(403);
    expect((await S.pmA.post('/users').send({})).status).toBe(403);
    expect((await S.custA.get('/audit-logs')).status).toBe(403);
    expect((await S.pmA.get('/admin/dashboard')).status).toBe(403);
    expect((await S.pmA.delete(`/projects/${S.project.id}`)).status).toBe(403);
    expect((await S.custA.get('/bills')).status).toBe(403);
  });

  it('serves the cover through an authenticated endpoint only', async () => {
    const url = `/files/${S.project.coverImageFileId}`;
    expect((await S.custA.get(url)).status).toBe(200);
    expect((await S.cust2A.get(url)).status).toBe(403);
    expect((await request(app).get(`/api/v1${url}`)).status).toBe(401);
  });
});

describe('Workflow 2: progress update', () => {
  it('PM posts progress with photos; project progress changes; customer and admin see it', async () => {
    const res = await S.pmA.post(`/projects/${S.project.id}/updates`)
      .field('type', 'PROGRESS').field('progressPercentage', '12').field('description', 'Foundation done')
      .attach('photos', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data.files).toHaveLength(1);
    const cust = await S.custA.get(`/projects/${S.project.id}`);
    expect(cust.body.data.overallProgress).toBe(12);
    expect(cust.body.data.status).toBe('IN_PROGRESS');
    expect((await S.custA.get(`/projects/${S.project.id}/updates`)).body.data).toHaveLength(1);
    expect((await S.admin.get(`/projects/${S.project.id}/updates`)).body.meta.total).toBe(1);
  });

  it('validates progress input, photo limit, and prevents customers posting', async () => {
    const bad = await S.pmA.post(`/projects/${S.project.id}/updates`).field('type', 'PROGRESS').field('progressPercentage', '150').field('description', 'x');
    expect(bad.status).toBe(400);
    let req = S.pmA.post(`/projects/${S.project.id}/updates`).field('type', 'PROGRESS').field('progressPercentage', '12').field('description', 'five photos');
    for (let i = 0; i < 5; i++) req = req.attach('photos', PNG, { filename: `p${i}.png`, contentType: 'image/png' });
    expect((await req).status).toBe(400);
    expect((await S.custA.post(`/projects/${S.project.id}/updates`).field('type', 'PROGRESS').field('progressPercentage', '5').field('description', 'hi')).status).toBe(403);
    expect((await S.pm2A.post(`/projects/${S.project.id}/updates`).field('type', 'PROGRESS').field('progressPercentage', '5').field('description', 'hi')).status).toBe(403);
  });

  it('posts a material update', async () => {
    const res = await S.pmA.post(`/projects/${S.project.id}/updates`).field('type', 'MATERIAL')
      .field('materialName', 'Cement').field('quantity', '200').field('unit', 'bags').field('deliveryStatus', 'DELIVERED');
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Material: Cement');
  });
});

describe('Workflow 3: customer decision', () => {
  it('PM requests approval; customer is notified, responds; PM and admin see the response', async () => {
    const res = await S.pmA.post(`/projects/${S.project.id}/updates`).field('type', 'APPROVAL_REQUEST')
      .field('title', 'Kitchen countertop').field('description', 'Choose material').field('requiresAdminApproval', 'true')
      .field('options', JSON.stringify([{ label: 'Black Galaxy', priceNote: 'Within BOQ' }, { label: 'Tan Brown', additionalCharge: 180, priceNote: '+₹180/sq.ft.' }]));
    expect(res.status).toBe(201);
    S.decisionId = res.body.data.decisionRequestId;

    const notifs = await S.custA.get('/notifications');
    expect(notifs.body.data.some((n) => n.notificationType === 'DECISION_REQUESTED')).toBe(true);
    const dash = await S.custA.get('/customer/dashboard');
    expect(dash.body.data.pendingDecisions).toHaveLength(1);

    const detail = (await S.custA.get(`/decisions/${S.decisionId}`)).body.data;
    expect(detail.status).toBe('PENDING_CUSTOMER');
    S.opt = detail.options.find((o) => o.label === 'Tan Brown');

    const r = await S.custA.post(`/decisions/${S.decisionId}/respond`).field('optionId', S.opt.id).field('comment', 'Prefer this one');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('RESPONDED');
    for (const who of [S.pmA, S.admin]) {
      const d = (await who.get(`/decisions/${S.decisionId}`)).body.data;
      expect(d.responses[0].optionLabel).toBe('Tan Brown');
    }
  });

  it('keeps history, blocks double answers, wrong-decision options and other customers', async () => {
    expect((await S.custA.post(`/decisions/${S.decisionId}/respond`).field('optionId', S.opt.id)).status).toBe(409);
    expect((await S.cust2A.post(`/decisions/${S.decisionId}/respond`).field('optionId', S.opt.id)).status).toBe(403);
    expect((await S.pmA.post(`/decisions/${S.decisionId}/respond`).field('optionId', S.opt.id)).status).toBe(403);
    const hist = (await S.admin.get(`/decisions/${S.decisionId}/history`)).body.data;
    expect(hist.history.map((h) => h.toStatus)).toEqual(['PENDING_CUSTOMER', 'RESPONDED']);
  });

  it('rejects an option that belongs to another decision (DB-level guarantee)', async () => {
    const second = await S.pmA.post(`/projects/${S.project.id}/decisions`)
      .field('title', 'Paint colour').field('options', JSON.stringify([{ label: 'White' }, { label: 'Cream' }]));
    expect(second.status).toBe(201);
    const res = await S.custA.post(`/decisions/${second.body.data.id}/respond`).field('optionId', S.opt.id);
    expect(res.status).toBe(400);
    await S.pmA.post(`/decisions/${second.body.data.id}/cancel`).send({});
  });

  it('escalated decision shows in admin approvals; admin approves it; PM cannot', async () => {
    const list = (await S.admin.get('/approvals?status=PENDING&type=DECISION_ESCALATION')).body.data;
    expect(list).toHaveLength(1);
    expect((await S.pmA.post(`/decisions/${S.decisionId}/finalize`).send({ action: 'APPROVE' })).status).toBe(403);
    const ok = await S.admin.post(`/approvals/${list[0].id}/approve`).send({ comment: 'Okay' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
    expect((await S.custA.get(`/decisions/${S.decisionId}`)).body.data.status).toBe('APPROVED');
  });
});

describe('Workflow 4: vendor bill approval with revisions', () => {
  const submit = (agent, extra = {}) => {
    let r = agent.post('/bills').field('projectId', S.project.id).field('vendorName', 'Sri Steel').field('invoiceNumber', 'INV-001').field('category', 'Cement')
      .field('amount', '150000').field('billDate', '2026-03-01');
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r;
  };

  it('PM submits a bill; validations and duplicate protection work', async () => {
    expect((await submit(S.pmA)).status).toBe(400); // no file
    expect((await submit(S.pmA, { amount: '-5' }).attach('file', PDF, 'b.pdf')).status).toBe(400);
    expect((await submit(S.pm2A).attach('file', PDF, 'b.pdf')).status).toBe(403); // not their project
    const ok = await submit(S.pmA).attach('file', PDF, { filename: 'b.pdf', contentType: 'application/pdf' });
    expect(ok.status).toBe(201);
    S.bill = ok.body.data;
    expect(S.bill.status).toBe('PENDING_ADMIN_REVIEW');
    expect((await submit(S.pmA).attach('file', PDF, 'b.pdf')).status).toBe(409);
  });

  it('PM cannot approve own bill; customers cannot see bills or their files', async () => {
    expect((await S.pmA.post(`/bills/${S.bill.id}/approve`).send({})).status).toBe(403);
    expect((await S.custA.get(`/bills/${S.bill.id}`)).status).toBe(403);
    expect((await S.custA.get(`/files/${S.bill.currentFileId}`)).status).toBe(403);
    expect((await S.pm2A.get(`/files/${S.bill.currentFileId}`)).status).toBe(403);
    expect((await S.pmA.get(`/files/${S.bill.currentFileId}`)).status).toBe(200);
  });

  it('admin requests clarification (comment required) and PM resubmits a new version', async () => {
    expect((await S.admin.post(`/bills/${S.bill.id}/request-clarification`).send({})).status).toBe(400);
    const cl = await S.admin.post(`/bills/${S.bill.id}/request-clarification`).send({ comment: 'GST number missing' });
    expect(cl.body.data.status).toBe('CLARIFICATION_REQUIRED');
    expect((await S.pmA.get('/notifications')).body.data.some((n) => n.notificationType === 'BILL_CLARIFICATION_REQUESTED')).toBe(true);
    expect((await S.admin.post(`/bills/${S.bill.id}/approve`).send({})).status).toBe(409); // wrong state

    const re = await S.pmA.post(`/bills/${S.bill.id}/resubmit`).field('note', 'Added GST')
      .attach('file', Buffer.concat([PDF, Buffer.from('\nrevised')]), { filename: 'b2.pdf', contentType: 'application/pdf' });
    expect(re.status).toBe(200);
    expect(re.body.data.status).toBe('PENDING_ADMIN_REVIEW');
    expect(re.body.data.currentVersion).toBe(2);
  });

  it('admin approves; versions and reviews are all preserved; approved != paid', async () => {
    expect((await S.admin.post(`/bills/${S.bill.id}/approve`).send({})).status).toBe(400); // mode required
    expect((await S.admin.post(`/bills/${S.bill.id}/approve`).send({ paymentMode: 'UPI' })).status).toBe(400); // UPI needs transaction id
    const ap = await S.admin.post(`/bills/${S.bill.id}/approve`).send({ comment: 'ok', paymentMode: 'UPI', paymentReference: 'UPI-TXN-99' });
    expect(ap.body.data.paymentMode).toBe('UPI');
    expect(ap.body.data.paymentReference).toBe('UPI-TXN-99');
    expect(ap.body.data.status).toBe('APPROVED');
    expect(ap.body.data.paidAt).toBeNull();
    const h = (await S.admin.get(`/bills/${S.bill.id}/history`)).body.data;
    expect(h.reviews.find((r) => r.action === 'APPROVE').comment).toContain('UPI (UPI-TXN-99)');
    expect(h.versions.map((v) => v.versionNo)).toEqual([1, 2]);
    expect(h.reviews.map((r) => r.action)).toEqual(['SUBMITTED', 'REQUEST_CLARIFICATION', 'RESUBMITTED', 'APPROVE']);
    const paid = await S.admin.post(`/bills/${S.bill.id}/mark-paid`).send({});
    expect(paid.body.data.status).toBe('PAID');
    expect((await S.admin.get('/approvals?type=BILL_REVIEW')).body.data[0].status).toBe('APPROVED');
  });

  it('filters bills for admin; PM sees only own projects', async () => {
    expect((await S.admin.get('/bills?status=PAID&vendor=steel')).body.meta.total).toBe(1);
    expect((await S.admin.get('/bills?minAmount=999999')).body.meta.total).toBe(0);
    expect((await S.pm2A.get('/bills')).body.meta.total).toBe(0);
  });
});

describe('Workflow 5: customer payments', () => {
  const pay = (extra = {}) => S.admin.post(`/projects/${S.project.id}/payments`).send({
    paymentType: 'ADVANCE', amount: 1_000_000, paymentMethod: 'BANK_TRANSFER', paymentDate: '2026-02-01', referenceNumber: 'UTR-1', ...extra });

  it('records a payment and updates payment progress separately from project progress', async () => {
    const res = await pay();
    expect(res.status).toBe(201);
    S.payment = res.body.data.payment;
    expect(res.body.data.summary).toMatchObject({ totalReceived: 1_000_000, outstanding: 4_000_000, paymentProgress: 20 });
    const p = (await S.custA.get(`/projects/${S.project.id}`)).body.data;
    expect(p.payment.paymentProgress).toBe(20);
    expect(p.overallProgress).toBe(12);
    expect((await S.pmA.get(`/projects/${S.project.id}/payments`)).status).toBe(403); // payments are hidden from PMs
  });

  it('blocks duplicates, overpayment, future dates, and non-admin recording', async () => {
    expect((await pay()).status).toBe(409);
    expect((await pay({ referenceNumber: 'utr-1' })).status).toBe(409);
    expect((await pay({ referenceNumber: 'UTR-9', amount: 4_500_000 })).status).toBe(409);
    expect((await pay({ referenceNumber: 'UTR-8', paymentDate: '2099-01-01' })).status).toBe(400);
    expect((await S.pmA.post(`/projects/${S.project.id}/payments`).send({})).status).toBe(403);
    expect((await S.cust2A.get(`/projects/${S.project.id}/payments`)).status).toBe(403);
  });

  it('numbers invoices BLH/<year>/<project code>/<001..> and serves a Word file', async () => {
    const code = S.project.projectCode.split('-').pop();
    expect(S.payment.invoiceNumber).toBe(`BLH/2026/${code}/001`);
    const second = await pay({ referenceNumber: 'UTR-2', amount: 500_000, paymentType: 'INSTALLMENT', invoiceDescription: 'Second stage' });
    expect(second.body.data.payment.invoiceNumber).toBe(`BLH/2026/${code}/002`);
    const bin = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
    const dl = await S.custA.get(`/payments/${S.payment.id}/invoice`).buffer(true).parse(bin);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('wordprocessingml.document');
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="Tax Invoice BLH-2026-${code}-001.docx"`);
    expect(dl.body.subarray(0, 2).toString()).toBe('PK'); // .docx is a zip
    expect((await S.admin.get(`/payments/${S.payment.id}/invoice`)).status).toBe(200);
  });

  it('keeps invoices private and payments permanent (no reversal)', async () => {
    expect((await S.pmA.get(`/payments/${S.payment.id}/invoice`)).status).toBe(403);
    expect((await S.cust2A.get(`/payments/${S.payment.id}/invoice`)).status).toBe(403);
    expect((await S.admin.post(`/payments/${S.payment.id}/reverse`).send({ reason: 'x' })).status).toBe(404);
    expect((await S.admin.get('/payments')).body.meta.total).toBe(2);
    expect((await S.admin.get('/admin/dashboard')).body.data.paymentsReceived).toBe(1_500_000);
  });

  it('cannot delete a project that has payments/bills (archive instead)', async () => {
    expect((await S.admin.delete(`/projects/${S.project.id}`)).status).toBe(409);
    const arch = await S.admin.patch(`/projects/${S.project.id}`).send({ status: 'IN_PROGRESS' });
    expect(arch.status).toBe(200);
  });
});

describe('Project ledger (bank-statement format)', () => {
  it('lists credits (customer payments) and debits (paid vendor bills) with a running balance', async () => {
    const res = await S.admin.get(`/projects/${S.project.id}/ledger`);
    expect(res.status).toBe(200);
    const { rows, totals } = res.body.data;
    expect(rows.map((r) => [r.credit, r.debit])).toEqual([[1_000_000, 0], [500_000, 0], [0, 150_000]]);
    expect(rows.map((r) => r.balance)).toEqual([1_000_000, 1_500_000, 1_350_000]);
    expect(rows[2]).toMatchObject({ mode: 'UPI', category: 'Cement' });
    expect(rows[0].mode).toBe('BANK_TRANSFER');
    expect(totals).toEqual({ credit: 1_500_000, debit: 150_000, closingBalance: 1_350_000 });
  });

  it('supports date filters with an opening balance, CSV export, and is admin-only', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const f = (await S.admin.get(`/projects/${S.project.id}/ledger?from=${today}`)).body.data;
    expect(f.openingBalance).toBe(1_500_000);
    expect(f.rows).toHaveLength(1);
    expect(f.totals.closingBalance).toBe(1_350_000);
    const xl = await S.admin.get(`/projects/${S.project.id}/ledger?format=xlsx`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xl.headers['content-type']).toContain('spreadsheetml.sheet');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xl.body);
    const ws = wb.getWorksheet('Ledger');
    expect(ws.getRow(5).values.slice(1)).toEqual(['Date', 'Description', 'Amount (Credit)', 'Mode of payment', 'Debit (Amount)', 'Category', 'Balance']);
    expect(ws.getRow(6).getCell(3).value).toBe(1_000_000); // real numbers, not text
    expect(ws.getRow(6).getCell(1).value).toBeInstanceOf(Date);
    expect(ws.getRow(8).getCell(6).value).toBe('Cement');
    expect(ws.getRow(9).getCell(7).value).toBe(1_350_000); // closing balance in the totals row
    expect((await S.pmA.get(`/projects/${S.project.id}/ledger`)).status).toBe(403);
    expect((await S.custA.get(`/projects/${S.project.id}/ledger`)).status).toBe(403);
  });
});

describe('Workflow 6: audit, notifications, user management', () => {
  it('captured every critical action', async () => {
    const actions = (await S.admin.get('/audit-logs?limit=100')).body.data.map((a) => a.actionType);
    for (const expected of ['LOGIN', 'LOGIN_FAILED', 'USER_CREATED', 'PROJECT_CREATED', 'PROJECT_USER_ASSIGNED', 'PROJECT_PROGRESS_CHANGED',
      'UPDATE_PROGRESS_CREATED', 'UPDATE_MATERIAL_CREATED', 'DECISION_CREATED', 'DECISION_RESPONDED', 'DECISION_APPROVED',
      'BILL_SUBMITTED', 'BILL_CLARIFICATION_REQUESTED', 'BILL_RESUBMITTED', 'BILL_APPROVED', 'BILL_PAID', 'PAYMENT_RECORDED']) {
      expect(actions, expected).toContain(expected);
    }
  });

  it('filters audit logs and keeps before/after data', async () => {
    const res = await S.admin.get(`/audit-logs?projectId=${S.project.id}&action=PROJECT_PROGRESS_CHANGED`);
    expect(res.body.data[0].previousData.overallProgress).toBe(0);
    expect(res.body.data[0].newData.overallProgress).toBe(12);
    expect((await S.admin.get('/audit-logs?from=2000-01-01&to=2000-01-02')).body.meta.total).toBe(0);
  });

  it('never stores secrets in audit payloads', async () => {
    const { rows } = await db.query("select count(*)::int n from audit_logs where new_data::text ilike '%password%' or previous_data::text ilike '%Password@123%'");
    expect(rows[0].n).toBe(0);
  });

  it('audit log is append-only at the database level', async () => {
    await expect(db.query("update audit_logs set description = 'x'")).rejects.toThrow(/append-only/);
    await expect(db.query('delete from audit_logs')).rejects.toThrow(/append-only/);
  });

  it('notification read flows', async () => {
    const list = (await S.custA.get('/notifications?unread=true')).body;
    expect(list.meta.unreadCount).toBeGreaterThan(0);
    await S.custA.patch(`/notifications/${list.data[0].id}/read`).send();
    await S.custA.patch('/notifications/read-all').send();
    expect((await S.custA.get('/notifications')).body.meta.unreadCount).toBe(0);
  });

  it('paginates and filters projects', async () => {
    const res = await S.admin.get('/projects?page=1&limit=1&q=sunrise&status=IN_PROGRESS');
    expect(res.body.meta).toMatchObject({ page: 1, limit: 1, total: 1 });
    expect((await S.admin.get('/projects?limit=1000')).status).toBe(400);
  });

  it('deactivation immediately blocks a user and revokes sessions', async () => {
    expect((await S.admin.patch(`/users/${S.cust2.id}/status`).send({ status: 'INACTIVE' })).status).toBe(200);
    expect((await S.cust2A.get('/auth/me')).status).toBe(401);
    expect((await login('cust2', 'Password@123')).res.status).toBe(401);
  });

  it('resets passwords securely', async () => {
    const r = await S.admin.post(`/users/${S.cust.id}/reset-password`).send({});
    expect(r.body.data.temporaryPassword).toBeTruthy();
    expect((await login('cust1', 'Password@123')).res.status).toBe(401);
    expect((await login('cust1', r.body.data.temporaryPassword)).res.status).toBe(200);
  });

  it('refresh token rotation: replayed tokens invalidate the session', async () => {
    const agent = request.agent(app);
    const l = await agent.post('/api/v1/auth/login').set(H).send({ username: 'pm1', password: 'Password@123' });
    const old = l.headers['set-cookie'].find((c) => c.startsWith('refresh_token='));
    const first = await agent.post('/api/v1/auth/refresh').set(H);
    expect(first.status).toBe(200);
    const replay = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', old.split(';')[0]);
    expect(replay.status).toBe(401);
  });
});
