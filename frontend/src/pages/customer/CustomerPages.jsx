import { useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Async } from '../../components/common/ui.jsx';
import ProjectView from '../shared/ProjectView.jsx';

export function CustomerDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => unwrap(api.get('/customer/dashboard')), []);
  const [selected, setSelected] = useState(null);
  const projects = data?.projects ?? [];
  const current = selected ?? projects[0]?.id;
  return (
    <div className="stack">
      <div><h1>Welcome, {user.fullName}</h1><p className="muted">Follow your home’s progress, payments and decisions in one place.</p></div>
      <Async loading={loading} error={error} onRetry={reload} empty={projects.length === 0} emptyText="No projects are assigned to you yet">
        {projects.length > 1 && (
          <div className="row" role="tablist" aria-label="Your projects">
            {projects.map((p) => (
              <button key={p.id} role="tab" aria-selected={current === p.id} className={`btn sm ${current === p.id ? '' : 'ghost'}`} onClick={() => setSelected(p.id)}>
                {p.name}{p.pendingDecisions > 0 && ` (${p.pendingDecisions})`}
              </button>
            ))}
          </div>
        )}
        {current && <ProjectView key={current} projectId={current} role="CUSTOMER" />}
      </Async>
    </div>
  );
}

export const CustomerProjectPage = () => {
  const { id } = useParams();
  return <ProjectView key={id} projectId={id} role="CUSTOMER" />;
};
