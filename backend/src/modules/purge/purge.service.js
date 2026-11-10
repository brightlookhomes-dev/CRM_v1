import { withTx } from '../../config/database.js';
import { AppError, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { enqueueFileDeletions, processFileDeletions } from '../../services/fileDeletion.service.js';

// Permanent (hard) deletes. Admin-only; callers must send confirm:"DELETE".
// The audit trail is kept (audit_logs has no foreign keys) and records what was destroyed.

export async function purgeProject(ctx, id) {
  let paths = [];
  await withTx(async (tx) => {
    const project = (await tx.query('select * from projects where id = $1 for update', [id])).rows[0];
    if (!project) throw notFound('Project');
    const q = (sql) => tx.query(sql, [id]);
    const counts = (await q(`select
      (select count(*)::int from project_updates where project_id = $1) as updates,
      (select count(*)::int from decision_requests where project_id = $1) as decisions,
      (select count(*)::int from vendor_bills where project_id = $1) as bills,
      (select count(*)::int from customer_payments where project_id = $1) as payments,
      (select coalesce(sum(amount), 0) from customer_payments where project_id = $1) as net_received`)).rows[0];
    paths = (await q('select storage_provider, relative_path from files where project_id = $1')).rows;
    await enqueueFileDeletions(tx, paths);

    await q('delete from project_update_files where update_id in (select id from project_updates where project_id = $1)');
    await q('delete from project_updates where project_id = $1');
    await q('delete from project_events where project_id = $1');
    await q('delete from project_stage_delays where project_id = $1');
    await q('delete from project_stages where project_id = $1');
    for (const t of ['decision_files', 'decision_history', 'decision_responses', 'decision_options']) {
      await q(`delete from ${t} where decision_id in (select id from decision_requests where project_id = $1)`);
    }
    await q('delete from decision_requests where project_id = $1');
    await q('delete from approval_actions where approval_id in (select id from approval_requests where project_id = $1)');
    await q('delete from approval_requests where project_id = $1');
    for (const t of ['vendor_bill_reviews', 'vendor_bill_attachments', 'vendor_bill_versions']) {
      await q(`delete from ${t} where bill_id in (select id from vendor_bills where project_id = $1)`);
    }
    await q('delete from vendor_bills where project_id = $1');
    await q('delete from customer_payments where project_id = $1');
    await q('delete from notifications where project_id = $1');
    await q('delete from project_progress_history where project_id = $1');
    await q('delete from project_assignments where project_id = $1');
    await q('delete from projects where id = $1');
    await q('delete from files where project_id = $1');

    await recordAudit(tx, ctx, { action: 'PROJECT_HARD_DELETED', module: 'PROJECTS', entityType: 'project', entityId: id, projectId: id,
      previous: { name: project.name, code: project.project_code, status: project.status, contractAmount: project.contract_amount, ...counts },
      description: `Project ${project.name} permanently deleted` });
  });
  return processFileDeletions();
}

export async function purgeBill(ctx, id) {
  let paths = [];
  await withTx(async (tx) => {
    const bill = (await tx.query('select * from vendor_bills where id = $1 for update', [id])).rows[0];
    if (!bill) throw notFound('Bill');
    const files = (await tx.query(
      `select f.id, f.storage_provider, f.relative_path from files f where f.id in (select file_id from vendor_bill_versions where bill_id = $1
         union select file_id from vendor_bill_attachments where bill_id = $1)`, [id])).rows;
    paths = files.map(({ storage_provider, relative_path }) => ({ storage_provider, relative_path }));
    await enqueueFileDeletions(tx, paths);
    await tx.query("delete from approval_actions where approval_id in (select id from approval_requests where entity_type = 'vendor_bill' and entity_id = $1)", [id]);
    await tx.query("delete from approval_requests where entity_type = 'vendor_bill' and entity_id = $1", [id]);
    for (const t of ['vendor_bill_reviews', 'vendor_bill_attachments', 'vendor_bill_versions']) await tx.query(`delete from ${t} where bill_id = $1`, [id]);
    await tx.query('delete from vendor_bills where id = $1', [id]);
    if (files.length) await tx.query('delete from files where id = any($1::uuid[])', [files.map((f) => f.id)]);
    await tx.query("delete from notifications where entity_type = 'vendor_bill' and entity_id = $1", [id]);
    await recordAudit(tx, ctx, { action: 'BILL_HARD_DELETED', module: 'BILLS', entityType: 'vendor_bill', entityId: id, projectId: bill.project_id,
      previous: { invoiceNumber: bill.invoice_number, vendor: bill.vendor_name, amount: bill.amount, status: bill.status, versions: bill.current_version },
      description: `Bill ${bill.invoice_number} permanently deleted` });
  });
  return processFileDeletions();
}

export async function purgeUpdate(ctx, id) {
  let paths = [];
  await withTx(async (tx) => {
    const u = (await tx.query('select * from project_updates where id = $1 for update', [id])).rows[0];
    if (!u) throw notFound('Update');
    const files = (await tx.query('select f.id, f.storage_provider, f.relative_path from project_update_files x join files f on f.id = x.file_id where x.update_id = $1', [id])).rows;
    paths = files.map(({ storage_provider, relative_path }) => ({ storage_provider, relative_path }));
    await enqueueFileDeletions(tx, paths);
    await tx.query('delete from project_update_files where update_id = $1', [id]);
    await tx.query('delete from project_updates where id = $1', [id]);
    if (files.length) await tx.query('delete from files where id = any($1::uuid[])', [files.map((f) => f.id)]);
    await tx.query("delete from notifications where entity_type = 'project_update' and entity_id = $1", [id]);
    await recordAudit(tx, ctx, { action: 'UPDATE_HARD_DELETED', module: 'UPDATES', entityType: 'project_update', entityId: id, projectId: u.project_id,
      previous: { type: u.update_type, title: u.title, description: u.description, progress: u.progress_percentage },
      description: 'Project update permanently deleted (project progress value is unchanged)' });
  });
  return processFileDeletions();
}

export async function purgeUser(ctx, id) {
  if (id === ctx.user.id) throw new AppError(409, 'You cannot delete your own account');
  try {
    await withTx(async (tx) => {
      const u = (await tx.query('select * from users where id = $1 for update', [id])).rows[0];
      if (!u) throw notFound('User');
      await tx.query('delete from notifications where recipient_id = $1', [id]);
      await tx.query('delete from project_assignments where user_id = $1', [id]);
      await tx.query('delete from users where id = $1', [id]); // refresh tokens cascade
      await recordAudit(tx, ctx, { action: 'USER_HARD_DELETED', module: 'USERS', entityType: 'user', entityId: id,
        previous: { username: u.username, fullName: u.full_name, role: u.role }, description: `User ${u.username} permanently deleted` });
    });
  } catch (err) {
    if (err?.code === '23503') {
      throw new AppError(409, 'This user has created records (projects, updates, bills, payments…) that must keep their author. Deactivate the account instead.');
    }
    throw err;
  }
}
