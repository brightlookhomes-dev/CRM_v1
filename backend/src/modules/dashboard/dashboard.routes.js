import { Router } from 'express';
import { db } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { asyncHandler, send, toCamel } from '../../utils/helpers.js';
import * as projectsRepo from '../projects/projects.repository.js';
import { shape } from '../projects/projects.service.js';

const router = Router();
router.use(authenticate);

router.get('/admin/dashboard', authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    select
      (select count(*)::int from projects where deleted_at is null and status in ('IN_PROGRESS','NOT_STARTED','PLANNED','ON_HOLD')) as active_projects,
      (select count(*)::int from projects where deleted_at is null and status = 'COMPLETED') as completed_projects,
      (select count(*)::int from approval_requests where status = 'PENDING') as pending_approvals,
      (select count(*)::int from vendor_bills where status in ('PENDING_ADMIN_REVIEW','RESUBMITTED')) as bills_awaiting_review,
      (select count(*)::int from users where role = 'CUSTOMER' and status = 'ACTIVE') as total_customers,
      (select count(*)::int from users where role = 'PROJECT_MANAGER' and status = 'ACTIVE') as total_project_managers,
      (select coalesce(sum(contract_amount), 0) from projects where deleted_at is null and status not in ('CANCELLED','ARCHIVED')) as total_contract_value,
      (select coalesce(sum(cp.amount), 0) from customer_payments cp join projects p on p.id = cp.project_id where p.deleted_at is null) as payments_received`);
  const s = toCamel(rows[0]);
  const received = Number(s.paymentsReceived);
  send(res, 'Dashboard retrieved', { ...s, outstandingReceivables: Math.max(0, Math.round((Number(s.totalContractValue) - received) * 100) / 100) });
}));

router.get('/pm/dashboard', authorize('PROJECT_MANAGER'), asyncHandler(async (req, res) => {
  const { rows } = await projectsRepo.list(db, { user: req.user, page: 1, limit: 100 });
  const bills = (await db.query(
    `select status, count(*)::int as n from vendor_bills b
      where exists (select 1 from project_assignments x where x.project_id = b.project_id and x.user_id = $1 and x.assignment_role = 'PROJECT_MANAGER' and x.is_active)
      group by status`, [req.user.id])).rows;
  const recentBills = (await db.query(
    `select b.id, b.invoice_number, b.vendor_name, b.amount, b.status, b.created_at, p.name as project_name
       from vendor_bills b join projects p on p.id = b.project_id
      where exists (select 1 from project_assignments x where x.project_id = b.project_id and x.user_id = $1 and x.assignment_role = 'PROJECT_MANAGER' and x.is_active)
      order by b.created_at desc limit 6`, [req.user.id])).rows;
  send(res, 'Dashboard retrieved', {
    projects: rows.map(shape),
    billCounts: Object.fromEntries(bills.map((b) => [b.status, b.n])),
    recentBills: toCamel(recentBills),
  });
}));

router.get('/customer/dashboard', authorize('CUSTOMER'), asyncHandler(async (req, res) => {
  const { rows } = await projectsRepo.list(db, { user: req.user, page: 1, limit: 50 });
  const pending = (await db.query(
    `select d.id, d.title, d.project_id, d.deadline from decision_requests d
      where d.status = 'PENDING_CUSTOMER' and exists (select 1 from project_assignments x where x.project_id = d.project_id and x.user_id = $1 and x.assignment_role = 'CUSTOMER' and x.is_active)`, [req.user.id])).rows;
  send(res, 'Dashboard retrieved', { projects: rows.map(shape), pendingDecisions: toCamel(pending) });
}));
export default router;
