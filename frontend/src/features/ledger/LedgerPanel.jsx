import { useState } from 'react';
import api, { unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { fmtDate, label } from '../../utils/format.js';
import { Async } from '../../components/common/ui.jsx';

const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amt = (n) => (n ? `₹${money.format(n)}` : '');

/** Bank-statement style ledger for one project (admin only). */
export default function LedgerPanel({ projectId }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(range).filter(([, v]) => v))).toString();
  const { data, loading, error, reload } = useFetch(() => unwrap(api.get(`/projects/${projectId}/ledger${qs ? `?${qs}` : ''}`)), [projectId, qs]);
  const csvUrl = `/api/v1/projects/${projectId}/ledger?${new URLSearchParams({ ...Object.fromEntries(Object.entries(range).filter(([, v]) => v)), format: 'xlsx' })}`;

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <label className="small row" style={{ fontWeight: 600 }}>From <input autoComplete="off" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ width: 'auto' }} /></label>
          <label className="small row" style={{ fontWeight: 600 }}>To <input autoComplete="off" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ width: 'auto' }} /></label>
          {(range.from || range.to) && <button className="btn sm ghost" onClick={() => setRange({ from: '', to: '' })}>Clear</button>}
        </div>
        <a className="btn sm ghost" href={csvUrl}>Download Excel</a>
      </div>
      <Async loading={loading} error={error} onRetry={reload} empty={data && data.rows.length === 0 && !data.openingBalance} emptyText="No transactions yet. Customer payments appear as credits, paid vendor bills as debits.">
        {data && (
          <div className="card table-wrap">
            <table className="table" aria-label="Project ledger">
              <thead><tr>
                <th>Date</th><th>Description</th><th className="right">Amount (Credit)</th><th>Mode of payment</th>
                <th className="right">Debit (Amount)</th><th>Category</th><th className="right">Balance</th>
              </tr></thead>
              <tbody>
                {data.openingBalance !== 0 && (
                  <tr><td /><td><em>Opening balance</em></td><td /><td /><td /><td /><td className="right"><strong>₹{money.format(data.openingBalance)}</strong></td></tr>
                )}
                {data.rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.description}{r.reference && <div className="small muted">Ref: {r.reference}</div>}</td>
                    <td className="right" style={{ color: 'var(--success)' }}>{amt(r.credit)}</td>
                    <td>{label(r.mode)}</td>
                    <td className="right" style={{ color: 'var(--error)' }}>{amt(r.debit)}</td>
                    <td>{r.category}</td>
                    <td className="right" style={{ fontWeight: 600, color: r.balance < 0 ? 'var(--error)' : undefined }}>₹{money.format(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg)' }}>
                  <td /><td><strong>Total</strong></td>
                  <td className="right"><strong>₹{money.format(data.totals.credit)}</strong></td><td />
                  <td className="right"><strong>₹{money.format(data.totals.debit)}</strong></td><td />
                  <td className="right"><strong>₹{money.format(data.totals.closingBalance)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Async>
    </div>
  );
}
