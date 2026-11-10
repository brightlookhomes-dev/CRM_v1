import { useState } from 'react';
import PermanentDelete from './PermanentDelete.jsx';
import { fmtDate, fmtDateTime, label } from '../../utils/format.js';
import { AttachmentGallery } from '../../components/common/Files.jsx';
import { StatusBadge, EmptyState } from '../../components/common/ui.jsx';

const ICON = { PROGRESS: '📈', MATERIAL: '🧱', GENERAL: '📝', APPROVAL_REQUEST: '✅' };

export default function UpdatesFeed({ updates, canDelete, onChanged }) {
  const [purging, setPurging] = useState(null);
  if (!updates.length) return <EmptyState title="No site updates yet" />;
  return (
    <div className="timeline" aria-label="Site updates">
      {purging && <PermanentDelete kind="update" id={purging.id} name={purging.title ?? purging.description?.slice(0, 40) ?? 'this update'} onCancel={() => setPurging(null)} onDeleted={() => { setPurging(null); onChanged?.(); }} />}
      {updates.map((u) => (
        <article key={u.id} className="item">
          <div className="row between">
            <div><strong>{u.createdByName}</strong> <span className="small muted">· {fmtDateTime(u.updateDate)}</span></div>
            <span className="badge info">{ICON[u.updateType]} {label(u.updateType)}</span>
          </div>
          {u.title && <h3>{u.title}</h3>}
          {u.progressPercentage != null && (
            <div className="small"><strong>{u.stageName ? `${u.stageName}: ${Math.round(u.progressPercentage)}% complete` : `Progress: ${Math.round(u.progressPercentage)}%`}</strong>
              {u.stageName && u.overallAfter != null && <span className="muted"> · Overall project {Math.round(u.overallAfter)}%</span>}</div>
          )}
          {u.description && <p style={{ margin: '.2rem 0' }}>{u.description}</p>}
          {u.workCompleted && <div className="small"><strong>Completed:</strong> {u.workCompleted}</div>}
          {u.workRemaining && <div className="small"><strong>Remaining:</strong> {u.workRemaining}</div>}
          {u.materialName && (
            <div className="small">{u.materialName} — {u.quantity} {u.unit} {u.supplier && `· ${u.supplier}`} {u.deliveryStatus && <StatusBadge status={u.deliveryStatus} />} {u.deliveryDate && `· ${fmtDate(u.deliveryDate)}`}</div>
          )}
          {u.decision && <div className="small">Decision: <StatusBadge status={u.decision.status} /></div>}
          <AttachmentGallery files={u.files} />
          {canDelete && <button className="btn sm danger" style={{ marginTop: '.5rem' }} onClick={() => setPurging(u)}>Delete permanently</button>}
        </article>
      ))}
    </div>
  );
}
