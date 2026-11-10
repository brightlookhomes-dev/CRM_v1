import { useEffect, useRef, useState } from 'react';

export function Modal({ title, onClose, children, size = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="row between" style={{ marginBottom: '.8rem' }}>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmText = 'Confirm', danger, onConfirm, onCancel, withComment, commentRequired, confirmPhrase }) {
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [typed, setTyped] = useState('');
  const invalid = (withComment && commentRequired && comment.trim().length < 2) || (confirmPhrase && typed !== confirmPhrase);
  const go = async () => {
    setBusy(true);
    try { await onConfirm(comment.trim() || undefined); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onCancel} size="small">
      <p>{message}</p>
      {confirmPhrase && (
        <div className="field">
          <label htmlFor="confirm-phrase">Type <strong>{confirmPhrase}</strong> to confirm</label>
          <input id="confirm-phrase" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
      {withComment && (
        <div className="field">
          <label htmlFor="confirm-comment">Comment{commentRequired ? ' (required)' : ''}</label>
          <textarea autoComplete="off" id="confirm-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? 'danger' : 'action'}`} onClick={go} disabled={busy || invalid}>{busy ? 'Working…' : confirmText}</button>
      </div>
    </Modal>
  );
}
