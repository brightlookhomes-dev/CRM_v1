import { useEffect, useState } from 'react';
import api, { errorMessage, toFormData } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fmtDate, fmtDateTime, inr } from '../../utils/format.js';
import { Modal, ConfirmDialog } from '../../components/common/Modal.jsx';
import { StatusBadge, EmptyState, Field } from '../../components/common/ui.jsx';
import { AttachmentGallery, FilePicker } from '../../components/common/Files.jsx';

function ReviewModal({ decisionId, onClose, onDone }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [optionId, setOptionId] = useState('');
  const [comment, setComment] = useState('');
  const [docs, setDocs] = useState([]);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    api.get(`/decisions/${decisionId}`).then((r) => setD(r.data.data)).catch((e) => setError(errorMessage(e)));
  }, [decisionId]);
  const submit = async () => {
    try {
      await api.post(`/decisions/${decisionId}/respond`, toFormData({ optionId, comment }, { documents: docs }));
      toast.success('Your response was sent to the project team');
      onDone();
    } catch (e) { toast.error(errorMessage(e)); setConfirm(false); }
  };
  const chosen = d?.options.find((o) => o.id === optionId);
  return (
    <Modal title="Review & Respond" onClose={onClose} size="wide">
      {error && <div className="alert">{error}</div>}
      {!d && !error && <div className="spinner" />}
      {d && (
        <div className="stack">
          <div><h3>{d.title}</h3><p>{d.description}</p>{d.details && <p className="muted">{d.details}</p>}
            <div className="small muted">Requested by {d.requestedByName} · {fmtDateTime(d.createdAt)}{d.deadline && ` · Respond by ${fmtDate(d.deadline)}`}</div>
            <AttachmentGallery files={d.files} /></div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend><strong>Choose an option</strong></legend>
            {d.options.map((o) => (
              <label key={o.id} className={`option ${optionId === o.id ? 'selected' : ''}`}>
                <input autoComplete="off" type="radio" name="option" value={o.id} checked={optionId === o.id} onChange={() => setOptionId(o.id)} />
                <span><strong>{o.label}</strong>{o.priceNote && <span className="badge action" style={{ marginLeft: '.5rem' }}>{o.priceNote}</span>}
                  {o.description && <div className="small muted">{o.description}</div>}
                  {o.additionalCharge > 0 && <div className="small">Additional charge: {inr(o.additionalCharge)}</div>}</span>
              </label>
            ))}
          </fieldset>
          <Field label="Comments (optional)" htmlFor="resp-comment"><textarea autoComplete="off" id="resp-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <FilePicker label="Supporting documents (optional)" name="resp-docs" multiple max={4} files={docs} error={fileError} onChange={(f, p) => { setDocs(f); setFileError(p); }} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn action" disabled={!optionId} onClick={() => setConfirm(true)}>Submit response</button>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog title="Confirm your response" confirmText="Yes, submit" message={`You are choosing "${chosen?.label}". This will be shared with your project manager and cannot be changed by you afterwards.`}
          onConfirm={submit} onCancel={() => setConfirm(false)} />
      )}
    </Modal>
  );
}

function DecisionCard({ d, role, onReview, onAction }) {
  const [confirm, setConfirm] = useState(null);
  const open = d.status === 'PENDING_CUSTOMER';
  const canFinalize = role !== 'CUSTOMER' && d.status === 'RESPONDED' && (role === 'ADMIN' || !d.requiresAdminApproval);
  return (
    <div className={`card flat ${open ? 'decision-card' : ''}`}>
      <div className="row between">
        <div className="row">{open && <span className="badge action">Approval request</span>}<StatusBadge status={d.status} /></div>
        <span className="small muted">{fmtDateTime(d.createdAt)}</span>
      </div>
      <h3 style={{ marginTop: '.5rem' }}>{d.title}</h3>
      {d.description && <p className="small">{d.description}</p>}
      <ul className="small" style={{ paddingLeft: '1.1rem', margin: '.3rem 0' }}>
        {d.options.map((o) => <li key={o.id}>{o.label}{o.priceNote && <span className="muted"> — {o.priceNote}</span>}</li>)}
      </ul>
      <AttachmentGallery files={d.files} />
      {d.latestResponse && (
        <div className="small" style={{ marginTop: '.5rem' }}>
          <strong>Response:</strong> {d.latestResponse.optionLabel} by {d.latestResponse.respondedBy} · {fmtDateTime(d.latestResponse.respondedAt)}
          {d.latestResponse.comment && <div className="muted">“{d.latestResponse.comment}”</div>}
        </div>
      )}
      <div className="row" style={{ marginTop: '.7rem' }}>
        {role === 'CUSTOMER' && open && <button className="btn action sm" onClick={() => onReview(d.id)}>Review &amp; Respond</button>}
        {canFinalize && <>
          <button className="btn sm" onClick={() => setConfirm('APPROVE')}>Approve</button>
          <button className="btn sm ghost" onClick={() => setConfirm('REOPEN')}>Ask again</button>
          <button className="btn sm danger" onClick={() => setConfirm('REJECT')}>Reject</button>
        </>}
        {role !== 'CUSTOMER' && open && <button className="btn sm ghost" onClick={() => setConfirm('CANCEL')}>Cancel request</button>}
      </div>
      {confirm && (
        <ConfirmDialog title={`${confirm === 'CANCEL' ? 'Cancel' : confirm === 'REOPEN' ? 'Ask again' : confirm === 'APPROVE' ? 'Approve' : 'Reject'} decision`}
          message={d.title} withComment commentRequired={confirm === 'REJECT'} danger={confirm === 'REJECT' || confirm === 'CANCEL'}
          onCancel={() => setConfirm(null)}
          onConfirm={async (comment) => { await onAction(d.id, confirm, comment); setConfirm(null); }} />
      )}
    </div>
  );
}

export default function DecisionsPanel({ decisions, role, reload }) {
  const toast = useToast();
  const [reviewing, setReviewing] = useState(null);
  const pending = decisions.filter((d) => d.status === 'PENDING_CUSTOMER');
  const rest = decisions.filter((d) => d.status !== 'PENDING_CUSTOMER');
  const act = async (id, action, comment) => {
    try {
      if (action === 'CANCEL') await api.post(`/decisions/${id}/cancel`, { comment });
      else await api.post(`/decisions/${id}/finalize`, { action, comment });
      toast.success('Decision updated');
      reload();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <section className="stack" aria-label="Decisions">
      <h2>{role === 'CUSTOMER' ? 'NEEDS YOUR DECISION' : 'Customer decisions'} {pending.length > 0 && <span className="badge action">{pending.length}</span>}</h2>
      {pending.length === 0 && <EmptyState title={role === 'CUSTOMER' ? 'No decisions need your attention' : 'No open decision requests'} />}
      {pending.map((d) => <DecisionCard key={d.id} d={d} role={role} onReview={setReviewing} onAction={act} />)}
      {rest.length > 0 && (<>
        <h3 className="muted">History</h3>
        {rest.map((d) => <DecisionCard key={d.id} d={d} role={role} onReview={setReviewing} onAction={act} />)}
      </>)}
      {reviewing && <ReviewModal decisionId={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); reload(); }} />}
    </section>
  );
}
