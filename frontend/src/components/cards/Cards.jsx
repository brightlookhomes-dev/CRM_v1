import { Link } from 'react-router-dom';
import { fileUrl } from '../../services/api.js';
import { inr } from '../../utils/format.js';
import { StatusBadge, ProgressLabel } from '../common/ui.jsx';

export function ProjectCard({ project: p, to, showAdminInfo, onPostUpdate }) {
  return (
    <article className="card project-card">
      <div className="thumb">
        {p.coverImageFileId && <img src={fileUrl(p.coverImageFileId)} alt={`${p.name} cover`} loading="lazy" />}
        <StatusBadge status={p.status} />
      </div>
      <div className="body">
        <div>
          <h3>{p.name}</h3>
          <div className="small muted">{p.location} · {p.projectType}</div>
        </div>
        <div className="small">
          {showAdminInfo && <div>PM: {p.projectManagers.map((m) => m.fullName).join(', ') || '—'}</div>}
          <div>Customer: {p.customers.map((m) => m.fullName).join(', ') || '—'}</div>
        </div>
        <ProgressLabel name="Progress" value={p.overallProgress} />
        <div className="row between small">
          <span>{p.pendingApprovals + p.pendingDecisions > 0
            ? <span className="badge action">{p.pendingApprovals + p.pendingDecisions} pending</span> : <span className="muted">No pending items</span>}</span>
          <span className="muted">{inr(p.contractAmount)}</span>
        </div>
        <div className="row" style={{ marginTop: 'auto' }}>
          <Link className="btn sm" to={to}>View</Link>
          {onPostUpdate && <button className="btn sm action" onClick={() => onPostUpdate(p)}>Post Update</button>}
        </div>
      </div>
    </article>
  );
}

export function PaymentSummary({ payment }) {
  return (
    <div className="card stack">
      <ProgressLabel name="Payment progress" value={payment.paymentProgress} variant="payment" />
      <div className="grid cols-3 small">
        <div><div className="muted">Agreed amount</div><strong>{inr(payment.totalAmount)}</strong></div>
        <div><div className="muted">Received</div><strong>{inr(payment.totalReceived)}</strong></div>
        <div><div className="muted">Outstanding</div><strong>{inr(payment.outstanding)}</strong></div>
      </div>
    </div>
  );
}

export function ProjectBanner({ project: p }) {
  return (
    <div className="banner">
      {p.coverImageFileId && <img src={fileUrl(p.coverImageFileId)} alt="" />}
      <div className="overlay">
        <div className="row"><StatusBadge status={p.status} /><span className="badge">{p.projectType}</span></div>
        <h1>{p.name}</h1>
        <div>📍 {p.location} · {Math.round(p.overallProgress)}% complete</div>
      </div>
    </div>
  );
}
