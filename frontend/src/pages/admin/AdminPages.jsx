import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage, unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fmtDate, fmtDateTime, inr, label } from '../../utils/format.js';
import { ConfirmDialog } from '../../components/common/Modal.jsx';
import { Async, Pagination, Stat, StatusBadge } from '../../components/common/ui.jsx';
import { InvoiceLinks } from '../../features/payments/PaymentsPanel.jsx';
import { BillsTable, ApproveBillDialog } from '../../features/bills/Bills.jsx';
import { ProjectCard } from '../../components/cards/Cards.jsx';

export function AdminDashboard() {
  const stats = useFetch(() => unwrap(api.get('/admin/dashboard')), []);
  const projects = useFetch(() => unwrap(api.get('/projects?limit=6')), []);
  const s = stats.data;
  return (
    <div className="stack">
      <div><h1>Builder Admin</h1><p className="muted">Everything across Brightlook Homes at a glance.</p></div>
      <Async loading={stats.loading} error={stats.error} onRetry={stats.reload}>
        {s && <div className="grid cols-4">
          <Stat label="Active projects" value={s.activeProjects} />
          <Stat label="Completed projects" value={s.completedProjects} />
          <Stat label="Pending approvals" value={s.pendingApprovals} />
          <Stat label="Bills awaiting review" value={s.billsAwaitingReview} />
          <Stat label="Customers" value={s.totalCustomers} />
          <Stat label="Project managers" value={s.totalProjectManagers} />
          <Stat label="Outstanding receivables" value={inr(s.outstandingReceivables)} hint={`of ${inr(s.totalContractValue)} contract value`} />
          <Stat label="Payments received" value={inr(s.paymentsReceived)} />
        </div>}
      </Async>
      <div className="row between"><h2>Recent projects</h2><Link to="/admin/projects" className="btn sm">Manage projects</Link></div>
      <Async loading={projects.loading} error={projects.error} onRetry={projects.reload} empty={projects.data?.length === 0} emptyText="No projects yet">
        <div className="grid cols-3">{projects.data?.map((p) => <ProjectCard key={p.id} project={p} to={`/admin/projects/${p.id}`} showAdminInfo />)}</div>
      </Async>
    </div>
  );
}

export function AdminApprovals() {
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const { data, meta, loading, error, reload } = useFetch(() => unwrap(api.get(`/approvals?page=${page}&limit=10${status ? `&status=${status}` : ''}`)), [page, status]);
  const [dlg, setDlg] = useState(null);
  const path = { approve: 'approve', reject: 'reject', clarify: 'request-clarification' };
  return (
    <div className="stack">
      <div className="row between"><h1>Pending approvals</h1>
        <select aria-label="Status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} style={{ width: 'auto' }}>
          <option value="PENDING">Pending</option><option value="">All</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="CLARIFICATION_REQUIRED">Clarification</option>
        </select></div>
      <Async loading={loading} error={error} onRetry={reload} empty={data?.length === 0} emptyText="Nothing to review 🎉">
        <div className="stack">
          {data?.map((a) => (
            <div key={a.id} className="card">
              <div className="row between"><div className="row"><span className="badge info">{label(a.approvalType)}</span><StatusBadge status={a.status} /></div><span className="small muted">{fmtDateTime(a.requestedAt)}</span></div>
              <h3 style={{ marginTop: '.4rem' }}>{a.title}</h3>
              <div className="small muted">{a.projectName} · requested by {a.requesterName}</div>
              {a.summary && <p className="small">{a.summary}</p>}
              {a.status === 'PENDING' && <div className="row">
                <button className="btn sm" onClick={() => setDlg({ a, type: 'approve' })}>Approve</button>
                <button className="btn sm ghost" onClick={() => setDlg({ a, type: 'clarify' })}>Request clarification</button>
                <button className="btn sm danger" onClick={() => setDlg({ a, type: 'reject' })}>Reject</button>
                <Link className="btn sm ghost" to={a.entityType === 'vendor_bill' ? '/admin/bills' : `/admin/projects/${a.projectId}`}>Open</Link>
              </div>}
            </div>
          ))}
        </div>
        <Pagination meta={meta} onPage={setPage} />
      </Async>
      {dlg?.type === 'approve' && dlg.a.entityType === 'vendor_bill' && (
        <ApproveBillDialog title={`Approve — ${dlg.a.title}`} subtitle={dlg.a.summary} onCancel={() => setDlg(null)}
          onSubmit={async (body) => { try { await api.post(`/approvals/${dlg.a.id}/approve`, body); toast.success('Bill approved'); setDlg(null); reload(); } catch (e) { toast.error(errorMessage(e)); } }} />
      )}
      {dlg && !(dlg.type === 'approve' && dlg.a.entityType === 'vendor_bill') && (
        <ConfirmDialog title={`${label(dlg.type)} — ${dlg.a.title}`} message="Your action and comment are recorded in the approval history." withComment commentRequired={dlg.type !== 'approve'}
          danger={dlg.type === 'reject'} confirmText={label(dlg.type)} onCancel={() => setDlg(null)}
          onConfirm={async (comment) => { try { await api.post(`/approvals/${dlg.a.id}/${path[dlg.type]}`, { comment }); toast.success('Done'); setDlg(null); reload(); } catch (e) { toast.error(errorMessage(e)); } }} />
      )}
    </div>
  );
}

export const AdminBills = () => (
  <div className="stack"><h1>Bills &amp; reviews</h1><BillsTable role="ADMIN" /></div>
);

export function AdminReceivables() {
  const [page, setPage] = useState(1);
  const { data, meta, loading, error, reload } = useFetch(() => unwrap(api.get(`/payments?page=${page}&limit=15`)), [page]);
  return (
    <div className="stack"><h1>Receivables &amp; customer payments</h1>
      <p className="muted">Record payments from a project’s Payments tab. This is the full ledger across projects.</p>
      <Async loading={loading} error={error} onRetry={reload} empty={data?.length === 0} emptyText="No payments recorded">
        <div className="card table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Project</th><th>Type</th><th>Method</th><th>Reference</th><th>Invoice</th><th className="right">Amount</th></tr></thead>
          <tbody>{data?.map((p) => (
            <tr key={p.id}><td>{fmtDate(p.paymentDate)}</td><td><Link to={`/admin/projects/${p.projectId}`}>{p.projectName}</Link></td>
              <td>{p.entryType === 'PAYMENT' ? label(p.paymentType) : <StatusBadge status={p.entryType} />}</td><td>{label(p.paymentMethod)}</td><td>{p.referenceNumber}</td><td><InvoiceLinks payment={p} /></td>
              <td className="right" style={{ color: p.amount < 0 ? 'var(--error)' : undefined }}>{inr(p.amount)}</td></tr>))}</tbody>
        </table></div>
        <Pagination meta={meta} onPage={setPage} />
      </Async>
    </div>
  );
}

const Diff = ({ before, after }) => {
  if (!before && !after) return null;
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return (
    <pre className="diff">{keys.map((k) => {
      const b = JSON.stringify(before?.[k]); const a = JSON.stringify(after?.[k]);
      return b === a ? `${k}: ${a}\n` : `${k}: ${b ?? '—'}  →  ${a ?? '—'}\n`;
    })}</pre>
  );
};

export function AdminAuditLogs() {
  const [f, setF] = useState({ q: '', module: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const { data, meta, loading, error, reload } = useFetch(() => unwrap(api.get(`/audit-logs?${qs}`)), [qs]);
  const set = (k) => (e) => { setPage(1); setF({ ...f, [k]: e.target.value }); };
  return (
    <div className="stack"><h1>Audit logs</h1>
      <div className="row">
        <input autoComplete="off" aria-label="Search" placeholder="Search description…" value={f.q} onChange={set('q')} style={{ maxWidth: 240 }} />
        <select aria-label="Module" value={f.module} onChange={set('module')} style={{ width: 'auto' }}><option value="">All modules</option>{['AUTH', 'USERS', 'PROJECTS', 'UPDATES', 'DECISIONS', 'BILLS', 'PAYMENTS'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>
        <input autoComplete="off" aria-label="From date" type="date" value={f.from} onChange={set('from')} style={{ width: 'auto' }} />
        <input autoComplete="off" aria-label="To date" type="date" value={f.to} onChange={set('to')} style={{ width: 'auto' }} />
      </div>
      <Async loading={loading} error={error} onRetry={reload} empty={data?.length === 0} emptyText="No audit events match">
        <div className="card table-wrap"><table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>{data?.map((a) => (
            <tr key={a.id}>
              <td className="small">{fmtDateTime(a.createdAt)}</td>
              <td>{a.actorName ?? '—'}<div className="small muted">{label(a.actorRole)} {a.ipAddress && `· ${a.ipAddress}`}</div></td>
              <td><span className="badge info">{a.actionType}</span><div className="small muted">{a.projectName}</div></td>
              <td><div className="small">{a.description}</div><Diff before={a.previousData} after={a.newData} /></td>
            </tr>))}</tbody>
        </table></div>
        <Pagination meta={meta} onPage={setPage} />
      </Async>
    </div>
  );
}
