import { useState } from 'react';
import api, { errorMessage, toFormData, unwrap, fileUrl } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fmtDate, inr, label } from '../../utils/format.js';
import { Modal } from '../../components/common/Modal.jsx';
import { Async, Field, StatusBadge } from '../../components/common/ui.jsx';
import { FilePicker } from '../../components/common/Files.jsx';
import { PaymentSummary } from '../../components/cards/Cards.jsx';
import { required, positive, collect } from '../../utils/validators.js';

/** Invoices are always Word (.docx) files, downloaded from the authenticated API. */
export function InvoiceLinks({ payment }) {
  if (!payment.invoiceNumber) return '—';
  return (
    <div>
      <strong className="small">{payment.invoiceNumber}</strong>
      <div className="small"><a href={`/api/v1/payments/${payment.id}/invoice`}>Download (Word)</a></div>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function RecordPaymentModal({ projectId, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ entryType: 'PAYMENT', paymentType: 'INSTALLMENT', paymentMethod: 'BANK_TRANSFER', paymentDate: today() });
  const [receipt, setReceipt] = useState([]);
  const [fileErr, setFileErr] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const found = collect({ amount: positive(f.amount), referenceNumber: required(f.referenceNumber, 'Reference number'), paymentDate: f.paymentDate > today() ? 'Date cannot be in the future' : required(f.paymentDate, 'Date') });
    setErrors(found);
    if (Object.keys(found).length || fileErr) return;
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/payments`, toFormData(f, { receipt }));
      toast.success('Payment recorded');
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Record customer payment" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Entry" htmlFor="et"><select id="et" value={f.entryType} onChange={set('entryType')}><option value="PAYMENT">Payment received</option><option value="REFUND">Refund to customer</option></select></Field>
          {f.entryType === 'PAYMENT' && <Field label="Payment type" htmlFor="pt"><select id="pt" value={f.paymentType} onChange={set('paymentType')}>{['ADVANCE', 'MILESTONE', 'INSTALLMENT', 'PARTIAL', 'FINAL'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></Field>}
          <Field label="Amount (₹)" error={errors.amount} htmlFor="am"><input autoComplete="off" id="am" type="number" min="0" step="0.01" onChange={set('amount')} /></Field>
          <Field label="Method" htmlFor="pm"><select id="pm" value={f.paymentMethod} onChange={set('paymentMethod')}>{['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
          <Field label="Payment date" error={errors.paymentDate} htmlFor="pd"><input autoComplete="off" id="pd" type="date" max={today()} value={f.paymentDate} onChange={set('paymentDate')} /></Field>
          <Field label="Transaction / reference no." error={errors.referenceNumber} htmlFor="rn"><input autoComplete="off" id="rn" onChange={set('referenceNumber')} /></Field>
        </div>
        {f.entryType === 'PAYMENT' && (
          <Field label="Invoice description (shown on the tax invoice)" htmlFor="idsc">
            <textarea autoComplete="off" id="idsc" rows={2} placeholder="e.g. False ceiling & flooring contract" onChange={set('invoiceDescription')} />
            <div className="small muted">An invoice is created automatically. The amount is treated as GST-inclusive (18%).</div>
          </Field>
        )}
        <Field label="Notes" htmlFor="nt"><textarea autoComplete="off" id="nt" rows={2} onChange={set('notes')} /></Field>
        <FilePicker label="Receipt / proof (optional)" name="receipt" files={receipt} error={fileErr} onChange={(files, p) => { setReceipt(files); setFileErr(p); }} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn action" disabled={busy}>{busy ? 'Saving…' : 'Record'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function PaymentsPanel({ project, role, onChanged }) {
  const { data, loading, error, reload } = useFetch(() => unwrap(api.get(`/projects/${project.id}/payments?limit=50`)), [project.id]);
  const [recording, setRecording] = useState(false);
  const refresh = () => { reload(); onChanged?.(); };
  return (
    <div className="stack">
      <PaymentSummary payment={project.payment} />
      {role === 'ADMIN' && <div><button className="btn action" onClick={() => setRecording(true)}>+ Record payment</button></div>}
      <Async loading={loading} error={error} onRetry={reload} empty={data?.length === 0} emptyText="No payments recorded">
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Method</th><th>Reference</th><th className="right">Amount</th><th style={{ paddingLeft: "2rem" }}>Invoice</th></tr></thead>
            <tbody>
              {data?.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.paymentDate)}</td>
                  <td>{p.entryType === 'PAYMENT' ? label(p.paymentType) : <StatusBadge status={p.entryType} />}</td>
                  <td>{label(p.paymentMethod)}</td><td>{p.referenceNumber}<div className="small muted">by {p.recordedByName}</div></td>
                  <td className="right" style={{ color: p.amount < 0 ? 'var(--error)' : undefined }}>{inr(p.amount)}</td>
                  <td style={{ paddingLeft: "2rem" }}><InvoiceLinks payment={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Async>
      {recording && <RecordPaymentModal projectId={project.id} onClose={() => setRecording(false)} onDone={() => { setRecording(false); refresh(); }} />}
    </div>
  );
}
