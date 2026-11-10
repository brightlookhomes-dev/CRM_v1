import { useState } from 'react';
import api, { errorMessage, toFormData, unwrap, fileUrl } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fmtDate, fmtDateTime, inr, label } from '../../utils/format.js';
import { Modal, ConfirmDialog } from '../../components/common/Modal.jsx';
import { Async, Field, Pagination, StatusBadge } from '../../components/common/ui.jsx';
import { FilePicker } from '../../components/common/Files.jsx';
import { required, positive, collect } from '../../utils/validators.js';
import PermanentDelete from '../projects/PermanentDelete.jsx';

export const BILL_CATEGORIES = ['Cement', 'Bricks', 'Steel', 'Sand', 'Aggregates', 'Tiles & Flooring', 'Electrical', 'Plumbing', 'Paint', 'Carpentry', 'Labour', 'Machinery & Equipment', 'Transport', 'Other'];

export function BillFormModal({ projects, defaultProjectId, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ projectId: defaultProjectId ?? projects[0]?.id ?? '', billDate: new Date().toISOString().slice(0, 10) });
  const [file, setFile] = useState([]);
  const [extra, setExtra] = useState([]);
  const [fileErr, setFileErr] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const found = collect({
      projectId: required(f.projectId, 'Project'), vendorName: required(f.vendorName, 'Vendor'), invoiceNumber: required(f.invoiceNumber, 'Invoice number'), category: required(f.category, 'Category'),
      amount: positive(f.amount), billDate: required(f.billDate, 'Bill date'),
      dueDate: f.dueDate && f.dueDate < f.billDate ? 'Due date cannot be before bill date' : '',
      file: file.length ? '' : 'Upload the bill (PDF or image)',
    });
    setErrors(found);
    if (Object.keys(found).length || fileErr.file || fileErr.extra) return;
    setBusy(true);
    try {
      await api.post('/bills', toFormData(f, { file, attachments: extra }));
      toast.success('Bill submitted to Admin for review');
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add bill / invoice" onClose={onClose} size="wide">
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Project" error={errors.projectId} htmlFor="b-proj"><select id="b-proj" value={f.projectId} onChange={set('projectId')}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Vendor / Supplier" error={errors.vendorName} htmlFor="b-vendor"><input autoComplete="off" id="b-vendor" onChange={set('vendorName')} /></Field>
          <Field label="Invoice number" error={errors.invoiceNumber} htmlFor="b-inv"><input autoComplete="off" id="b-inv" onChange={set('invoiceNumber')} /></Field>
          <Field label="Category" error={errors.category} htmlFor="b-cat">
            <select id="b-cat" value={f.category ?? ''} onChange={set('category')}>
              <option value="">Select category…</option>
              {BILL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Amount (₹)" error={errors.amount} htmlFor="b-amt"><input autoComplete="off" id="b-amt" type="number" min="0" step="0.01" onChange={set('amount')} /></Field>
          <Field label="Tax amount (optional)" htmlFor="b-tax"><input autoComplete="off" id="b-tax" type="number" min="0" step="0.01" onChange={set('taxAmount')} /></Field>
          <Field label="Bill date" error={errors.billDate} htmlFor="b-date"><input autoComplete="off" id="b-date" type="date" value={f.billDate} onChange={set('billDate')} /></Field>
          <Field label="Due date (optional)" error={errors.dueDate} htmlFor="b-due"><input autoComplete="off" id="b-due" type="date" onChange={set('dueDate')} /></Field>
        </div>
        <Field label="Description / note" htmlFor="b-desc"><textarea autoComplete="off" id="b-desc" rows={2} onChange={set('description')} /></Field>
        <FilePicker label="Bill document (PDF or image)" name="bill-file" files={file} error={errors.file || fileErr.file} onChange={(x, p) => { setFile(x); setFileErr((e) => ({ ...e, file: p })); }} />
        <FilePicker label="Supporting documents (optional)" name="bill-extra" multiple max={5} files={extra} error={fileErr.extra} onChange={(x, p) => { setExtra(x); setFileErr((e) => ({ ...e, extra: p })); }} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn action" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
        </div>
      </form>
    </Modal>
  );
}

export const PAYMENT_MODES = [
  { value: 'CASH', label: 'Cash', ref: null },
  { value: 'UPI', label: 'UPI', ref: 'UPI transaction ID' },
  { value: 'CHEQUE', label: 'Cheque', ref: 'Cheque number' },
  { value: 'NET_BANKING', label: 'Net banking', ref: 'Transaction ID' },
  { value: 'NEFT', label: 'NEFT', ref: 'UTR / transaction reference' },
  { value: 'RTGS', label: 'RTGS', ref: 'UTR / transaction reference' },
  { value: 'IMPS', label: 'IMPS', ref: 'Transaction reference' },
  { value: 'OTHER', label: 'Other', ref: 'Reference number' },
];

/** Approve a bill: admin picks the payment mode; the reference field adapts to the mode. */
export function ApproveBillDialog({ title, subtitle, onCancel, onSubmit }) {
  const [mode, setMode] = useState('');
  const [reference, setReference] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const current = PAYMENT_MODES.find((m) => m.value === mode);
  const refError = current?.ref && reference.trim().length < 2 ? `${current.ref} is required` : '';
  const go = async (e) => {
    e.preventDefault();
    if (!mode || refError) return;
    setBusy(true);
    try { await onSubmit({ paymentMode: mode, paymentReference: reference.trim() || undefined, comment: comment.trim() || undefined }); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onCancel} size="small">
      <form onSubmit={go} noValidate>
        {subtitle && <p>{subtitle}</p>}
        <Field label="Mode of payment" htmlFor="pay-mode">
          <select id="pay-mode" value={mode} onChange={(e) => { setMode(e.target.value); setReference(''); }} autoFocus>
            <option value="">Select mode of payment…</option>
            {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        {current?.ref && (
          <Field label={current.ref} error={reference && refError} htmlFor="pay-ref">
            <input id="pay-ref" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
        {mode === 'CASH' && <p className="small muted">No reference needed for cash.</p>}
        <Field label="Comment (optional)" htmlFor="pay-comment"><textarea autoComplete="off" id="pay-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn action" disabled={busy || !mode || !!refError}>{busy ? 'Approving…' : 'Approve'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResubmitModal({ bill, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [file, setFile] = useState([]);
  const [fileErr, setFileErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    if (note.trim().length < 2 || fileErr) return;
    setBusy(true);
    try { await api.post(`/bills/${bill.id}/resubmit`, toFormData({ note }, { file })); toast.success('Revised bill submitted'); onDone(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Resubmit ${bill.invoiceNumber}`} onClose={onClose} size="small">
      <div className="alert" style={{ marginBottom: '.8rem' }}><strong>Admin asked:</strong> {bill.lastClarification}</div>
      <form onSubmit={go}>
        <Field label="Your response" htmlFor="rs-note"><textarea autoComplete="off" id="rs-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <FilePicker label="Revised document (optional)" name="rs-file" files={file} error={fileErr} onChange={(x, p) => { setFile(x); setFileErr(p); }} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn action" disabled={busy || note.trim().length < 2}>Resubmit</button></div>
      </form>
    </Modal>
  );
}

function HistoryModal({ bill, onClose }) {
  const { data, loading, error } = useFetch(() => unwrap(api.get(`/bills/${bill.id}/history`)), [bill.id]);
  return (
    <Modal title={`History — ${bill.invoiceNumber}`} onClose={onClose}>
      <Async loading={loading} error={error}>
        <h3>Versions</h3>
        {data?.versions.map((v) => (
          <div key={v.versionNo} className="small" style={{ marginBottom: '.4rem' }}>
            <strong>v{v.versionNo}</strong> · {inr(v.amount)} · {v.submittedByName} · {fmtDateTime(v.createdAt)} · <a href={fileUrl(v.fileId)} target="_blank" rel="noreferrer">{v.fileName}</a>
            {v.note && <div className="muted">{v.note}</div>}
          </div>
        ))}
        <h3 style={{ marginTop: '1rem' }}>Review trail</h3>
        <div className="timeline">
          {data?.reviews.map((r) => (
            <div key={r.id} className="item small"><strong>{label(r.action)}</strong> by {r.actorName} <span className="muted">· {fmtDateTime(r.createdAt)} · v{r.versionNo}</span>
              {r.comment && <div>{r.comment}</div>}</div>
          ))}
        </div>
      </Async>
    </Modal>
  );
}

/** Bills table used by both Admin (review actions) and PM (status + resubmit). */
export function BillsTable({ role, params = {}, refreshKey = 0 }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', vendor: '' });
  const qs = new URLSearchParams({ page, limit: 10, ...Object.fromEntries(Object.entries({ ...params, ...filters }).filter(([, v]) => v)) }).toString();
  const { data, meta, loading, error, reload } = useFetch(() => unwrap(api.get(`/bills?${qs}`)), [qs, refreshKey]);
  const [dialog, setDialog] = useState(null); // {type, bill}

  const run = async (path, body, msg) => {
    try { await api.post(path, body); toast.success(msg); setDialog(null); reload(); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="stack">
      <div className="row">
        <select aria-label="Filter by status" value={filters.status} onChange={(e) => { setPage(1); setFilters({ ...filters, status: e.target.value }); }} style={{ width: 'auto' }}>
          <option value="">All statuses</option>
          {['PENDING_ADMIN_REVIEW', 'CLARIFICATION_REQUIRED', 'APPROVED', 'REJECTED', 'PAID'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        {role === 'ADMIN' && (
          <input autoComplete="off" aria-label="Filter by vendor" placeholder="Vendor…" value={filters.vendor} onChange={(e) => { setPage(1); setFilters({ ...filters, vendor: e.target.value }); }} style={{ maxWidth: 220 }} />
        )}
      </div>
      <Async loading={loading} error={error} onRetry={reload} empty={data?.length === 0} emptyText="No bills found">
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Invoice</th><th>Project</th><th>Vendor</th><th className="right">Amount</th><th>Bill date</th><th>Submitted by</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data?.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.invoiceNumber}</strong> <span className="small muted">v{b.currentVersion}</span><div>{b.currentFileId && <a className="small" href={fileUrl(b.currentFileId)} target="_blank" rel="noreferrer">📄 {b.currentFileName}</a>}</div></td>
                  <td>{b.projectName}</td><td>{b.vendorName}{b.category && <div className="small muted">{b.category}</div>}</td><td className="right">{inr(b.amount)}</td><td>{fmtDate(b.billDate)}</td><td>{b.submittedByName}</td>
                  <td><StatusBadge status={b.status} />{b.paymentMode && <div className="small muted">{label(b.paymentMode)}{b.paymentReference && ` · ${b.paymentReference}`}</div>}{b.status === 'CLARIFICATION_REQUIRED' && <div className="small muted">{b.lastClarification}</div>}</td>
                  <td><div className="row">
                    {role !== 'ADMIN' && <button className="btn sm ghost" onClick={() => setDialog({ type: 'history', bill: b })}>History</button>}
                    {role === 'ADMIN' && b.status === 'PENDING_ADMIN_REVIEW' && <>
                      <button className="btn sm" onClick={() => setDialog({ type: 'approve', bill: b })}>Approve</button>
                      <button className="btn sm danger" onClick={() => setDialog({ type: 'reject', bill: b })}>Reject</button></>}
                    {role === 'ADMIN' && <button className="btn sm danger" onClick={() => setDialog({ type: 'purge', bill: b })}>Delete</button>}
                    {role === 'ADMIN' && b.status === 'APPROVED' && <button className="btn sm action" onClick={() => setDialog({ type: 'paid', bill: b })}>Mark paid</button>}
                    {role === 'PROJECT_MANAGER' && b.status === 'CLARIFICATION_REQUIRED' && <button className="btn sm action" onClick={() => setDialog({ type: 'resubmit', bill: b })}>Respond</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination meta={meta} onPage={setPage} />
      </Async>
      {dialog?.type === 'purge' && <PermanentDelete kind="bill" id={dialog.bill.id} name={`${dialog.bill.vendorName} — ${dialog.bill.invoiceNumber}`} onCancel={() => setDialog(null)} onDeleted={() => { setDialog(null); reload(); }} />}
      {dialog?.type === 'history' && <HistoryModal bill={dialog.bill} onClose={() => setDialog(null)} />}
      {dialog?.type === 'resubmit' && <ResubmitModal bill={dialog.bill} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
      {dialog?.type === 'approve' && (
        <ApproveBillDialog title={`Approve bill ${dialog.bill.invoiceNumber}`} subtitle={`${dialog.bill.vendorName} — ${inr(dialog.bill.amount)}`}
          onCancel={() => setDialog(null)} onSubmit={(body) => run(`/bills/${dialog.bill.id}/approve`, body, 'Bill approved')} />
      )}
      {['reject', 'clarify'].includes(dialog?.type) && (
        <ConfirmDialog title={`${label(dialog.type)} bill ${dialog.bill.invoiceNumber}`} message={`${dialog.bill.vendorName} — ${inr(dialog.bill.amount)}`} withComment commentRequired={dialog.type !== 'approve'}
          danger={dialog.type === 'reject'} confirmText={label(dialog.type)} onCancel={() => setDialog(null)}
          onConfirm={(comment) => run(`/bills/${dialog.bill.id}/${dialog.type === 'clarify' ? 'request-clarification' : dialog.type}`, { comment }, 'Bill updated')} />
      )}
      {dialog?.type === 'paid' && (
        <ConfirmDialog title="Mark bill as paid" confirmText="Mark paid" onCancel={() => setDialog(null)}
          message={`${dialog.bill.vendorName} — ${inr(dialog.bill.amount)} via ${label(dialog.bill.paymentMode)}${dialog.bill.paymentReference ? ` (${dialog.bill.paymentReference})` : ''}. Confirm the payment has been made?`}
          onConfirm={() => run(`/bills/${dialog.bill.id}/mark-paid`, {}, 'Bill marked as paid')} />
      )}
    </div>
  );
}
