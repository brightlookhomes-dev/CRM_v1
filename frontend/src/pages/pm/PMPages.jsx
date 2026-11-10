import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Async, Stat } from '../../components/common/ui.jsx';
import { ProjectCard } from '../../components/cards/Cards.jsx';
import PostUpdateModal from '../../features/projects/PostUpdateModal.jsx';
import { BillsTable, BillFormModal } from '../../features/bills/Bills.jsx';
import ProjectView from '../shared/ProjectView.jsx';

export function PMDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => unwrap(api.get('/pm/dashboard')), []);
  const [posting, setPosting] = useState(null);
  const [billing, setBilling] = useState(false);
  const projects = data?.projects ?? [];
  const counts = data?.billCounts ?? {};
  return (
    <div className="stack">
      <div>
        <h1>Namaste, {user.fullName} 👋</h1>
        <p className="muted">Post an update — customers see it instantly.</p>
      </div>
      <section className="card stack" aria-label="Bills and invoices">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Bills &amp; Invoices</h2>
          <button className="btn action" disabled={!projects.length} onClick={() => setBilling(true)}>+ Add Bill / Invoice</button>
        </div>
        <div className="grid cols-4">
          <Stat label="Awaiting review" value={counts.PENDING_ADMIN_REVIEW ?? 0} />
          <Stat label="Clarification needed" value={counts.CLARIFICATION_REQUIRED ?? 0} />
          <Stat label="Approved" value={counts.APPROVED ?? 0} />
          <Stat label="Paid" value={counts.PAID ?? 0} />
        </div>
        <Link to="/pm/bills" className="btn sm ghost" style={{ alignSelf: "flex-start" }}>View all bills →</Link>
      </section>
      <section className="stack">
        <h2>Your projects</h2>
        <Async loading={loading} error={error} onRetry={reload} empty={projects.length === 0} emptyText="No projects assigned to you yet">
          <div className="grid cols-3">
            {projects.map((p) => <ProjectCard key={p.id} project={p} to={`/pm/projects/${p.id}`} onPostUpdate={setPosting} />)}
          </div>
        </Async>
      </section>
      {posting && <PostUpdateModal project={posting} onClose={() => setPosting(null)} onDone={() => { setPosting(null); reload(); }} />}
      {billing && <BillFormModal projects={projects} onClose={() => setBilling(false)} onDone={() => { setBilling(false); reload(); }} />}
    </div>
  );
}

export function PMProjects() {
  const { data, loading, error, reload } = useFetch(() => unwrap(api.get('/projects?limit=100')), []);
  return (
    <div className="stack"><h1>My projects</h1>
      <Async loading={loading} error={error} onRetry={reload} empty={data?.length === 0} emptyText="No projects assigned to you yet">
        <div className="grid cols-3">{data?.map((p) => <ProjectCard key={p.id} project={p} to={`/pm/projects/${p.id}`} />)}</div>
      </Async>
    </div>
  );
}

export const PMProjectPage = () => {
  const { id } = useParams();
  return <ProjectView key={id} projectId={id} role="PROJECT_MANAGER" />;
};

export function PMBills() {
  const [key, setKey] = useState(0);
  const [billing, setBilling] = useState(false);
  const projects = useFetch(() => unwrap(api.get('/projects?limit=100')), []);
  return (
    <div className="stack">
      <div className="row between"><h1>Bills &amp; Invoices</h1>
        <button className="btn action" disabled={!projects.data?.length} onClick={() => setBilling(true)}>+ Add Bill / Invoice</button></div>
      <BillsTable role="PROJECT_MANAGER" refreshKey={key} />
      {billing && <BillFormModal projects={projects.data} onClose={() => setBilling(false)} onDone={() => { setBilling(false); setKey((k) => k + 1); }} />}
    </div>
  );
}
