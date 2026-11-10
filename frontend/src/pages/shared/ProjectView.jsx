import { useState } from 'react';
import api, { unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { fmtDate, inr, progressSplit } from '../../utils/format.js';
import { Async, ProgressLabel, Tabs, Spinner, ErrorState } from '../../components/common/ui.jsx';
import { PaymentSummary, ProjectBanner } from '../../components/cards/Cards.jsx';
import DecisionsPanel from '../../features/decisions/DecisionsPanel.jsx';
import UpdatesFeed from '../../features/projects/UpdatesFeed.jsx';
import PostUpdateModal from '../../features/projects/PostUpdateModal.jsx';
import CalendarPanel from '../../features/stages/CalendarPanel.jsx';
import StagesProgress from '../../features/stages/StagesProgress.jsx';
import LedgerPanel from '../../features/ledger/LedgerPanel.jsx';
import PaymentsPanel from '../../features/payments/PaymentsPanel.jsx';
import { BillsTable, BillFormModal } from '../../features/bills/Bills.jsx';

/** One project page for all roles: same structure, role decides which management controls appear. */
export default function ProjectView({ projectId, role }) {
  const project = useFetch(() => unwrap(api.get(`/projects/${projectId}`)), [projectId]);
  const decisions = useFetch(() => unwrap(api.get(`/projects/${projectId}/decisions?limit=50`)), [projectId]);
  const [page, setPage] = useState(1);
  const updates = useFetch(() => unwrap(api.get(`/projects/${projectId}/updates?page=${page}&limit=10`)), [projectId, page]);
  const [tab, setTab] = useState('overview');
  const [posting, setPosting] = useState(null);
  const [billing, setBilling] = useState(false);
  const [billKey, setBillKey] = useState(0);

  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorState message={project.error} onRetry={project.reload} />;
  const p = project.data;
  const split = progressSplit(p.overallProgress);
  const canManage = role === 'ADMIN' || role === 'PROJECT_MANAGER';
  const showPayments = role !== 'PROJECT_MANAGER';
  const tabs = [{ key: 'overview', label: 'Overview' }, ...(showPayments ? [{ key: 'payments', label: 'Payments' }] : []), ...(canManage ? [{ key: 'bills', label: 'Bills' }] : []), ...(role === 'ADMIN' ? [{ key: 'ledger', label: 'Ledger' }, { key: 'calendar', label: 'Calendar' }] : [])];
  const refreshAll = () => { project.reload(); decisions.reload(); updates.reload(); };

  return (
    <div className="stack">
      <ProjectBanner project={p} />
      {canManage && (
        <div className="row">
          <button className="btn action" onClick={() => setPosting('PROGRESS')}>Post progress update</button>
          <button className="btn ghost" onClick={() => setPosting('MATERIAL')}>Material update</button>
          <button className="btn ghost" onClick={() => setPosting('APPROVAL_REQUEST')}>Request approval</button>
        </div>
      )}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (<>
        <div className="grid cols-2">
          <div className="card stack">
            <h2>Project progress</h2>
            <ProgressLabel name="Overall completion" value={p.overallProgress} />
            <div className="grid cols-3 small">
              <div><div className="muted">Completed</div><strong>{split.completed}%</strong></div>
              <div><div className="muted">Pending</div><strong>{split.pending}%</strong></div>
              <div><div className="muted">Status</div><strong>{p.status.replace('_', ' ')}</strong></div>
            </div>
            <div className="small muted">
              {p.startDate && `Started ${fmtDate(p.startDate)}`}{p.expectedCompletionDate && ` · Expected ${fmtDate(p.expectedCompletionDate)}`} · Code {p.projectCode}
            </div>
          </div>
          {showPayments && <div className="stack"><h2>Payment progress</h2><PaymentSummary payment={p.payment} /></div>}
        </div>
        <StagesProgress projectId={p.id} refreshKey={p.overallProgress} />
        {p.description && <div className="card"><h3>About this project</h3><p className="muted" style={{ margin: 0 }}>{p.description}</p></div>}

        <Async loading={decisions.loading} error={decisions.error} onRetry={decisions.reload}>
          <DecisionsPanel decisions={decisions.data ?? []} role={role} reload={refreshAll} />
        </Async>

        <section className="stack">
          <h2>Site updates</h2>
          <Async loading={updates.loading} error={updates.error} onRetry={updates.reload}>
            <UpdatesFeed updates={updates.data ?? []} canDelete={role === 'ADMIN'} onChanged={updates.reload} />
            {updates.meta?.totalPages > 1 && (
              <div className="row"><button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
                <button className="btn ghost sm" disabled={page >= updates.meta.totalPages} onClick={() => setPage(page + 1)}>Older</button></div>
            )}
          </Async>
        </section>
      </>)}

      {tab === 'payments' && showPayments && <PaymentsPanel project={p} role={role} onChanged={project.reload} />}
      {tab === 'bills' && (<div className="stack">
        {role === 'PROJECT_MANAGER' && <div><button className="btn action" onClick={() => setBilling(true)}>+ Add bill / invoice</button></div>}
        <BillsTable role={role} params={{ projectId }} refreshKey={billKey} />
      </div>)}

      {tab === 'ledger' && role === 'ADMIN' && <LedgerPanel projectId={p.id} />}
      {tab === 'calendar' && role === 'ADMIN' && <CalendarPanel projectId={p.id} onChanged={project.reload} />}

      {posting && <PostUpdateModal project={p} initialType={posting} onClose={() => setPosting(null)} onDone={() => { setPosting(null); refreshAll(); }} />}
      {billing && <BillFormModal projects={[p]} defaultProjectId={p.id} onClose={() => setBilling(false)} onDone={() => { setBilling(false); setBillKey((k) => k + 1); }} />}
    </div>
  );
}
