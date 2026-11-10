import { label, pct } from '../../utils/format.js';

const TONE = {
  COMPLETED: 'success', APPROVED: 'success', PAID: 'success', ACTIVE: 'success', DELIVERED: 'success', RESPONDED: 'info',
  IN_PROGRESS: 'info', PENDING_ADMIN_REVIEW: 'warn', PENDING_CUSTOMER: 'action', PENDING: 'warn', CLARIFICATION_REQUIRED: 'warn',
  ON_HOLD: 'warn', REJECTED: 'error', CANCELLED: 'error', INACTIVE: 'error', EXPIRED: 'error', ARCHIVED: '',
};

export const StatusBadge = ({ status }) => <span className={`badge ${TONE[status] ?? ''}`}>{label(status)}</span>;

export function ProgressBar({ value, variant = 'project', name }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  return (
    <div className={`progress ${variant === 'payment' ? 'pay' : ''}`} role="progressbar" aria-label={name} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${v}%` }} />
    </div>
  );
}

export const ProgressLabel = ({ name, value, variant }) => (
  <div>
    <div className="row between small"><strong>{name}</strong><span>{pct(value)}</span></div>
    <ProgressBar value={value} variant={variant} name={name} />
  </div>
);

export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;
export const EmptyState = ({ title = 'Nothing here yet', children }) => (
  <div className="empty"><strong>{title}</strong>{children && <div className="small">{children}</div>}</div>
);
export const ErrorState = ({ message, onRetry }) => (
  <div className="alert" role="alert">{message} {onRetry && <button className="btn sm ghost" onClick={onRetry}>Retry</button>}</div>
);

/** Handles loading / error / empty uniformly. */
export function Async({ loading, error, onRetry, empty, emptyText, children }) {
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (empty) return <EmptyState title={emptyText} />;
  return children;
}

export const Stat = ({ label: l, value, hint }) => (
  <div className="card stat"><span className="label">{l}</span><span className="value">{value}</span>{hint && <span className="small muted">{hint}</span>}</div>
);

export function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="row between" style={{ marginTop: '.8rem' }}>
      <span className="small muted">Page {meta.page} of {meta.totalPages} · {meta.total} records</span>
      <div className="row">
        <button className="btn sm ghost" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
        <button className="btn sm ghost" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Field({ label: l, error, children, htmlFor }) {
  return (
    <div className={`field ${error ? 'invalid' : ''}`}>
      <label htmlFor={htmlFor}>{l}</label>
      {children}
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  );
}
