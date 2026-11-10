export const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

export const pct = (n) => `${Math.round((Number(n) || 0) * 10) / 10}%`;
export const label = (s) => (s ? String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w|\s\w/g, (c) => c.toUpperCase()) : '');

export const ROLE_HOME = { ADMIN: '/admin/dashboard', PROJECT_MANAGER: '/pm/dashboard', CUSTOMER: '/customer/dashboard' };
export const ROLE_PREFIX = { ADMIN: '/admin', PROJECT_MANAGER: '/pm', CUSTOMER: '/customer' };

/** Completed vs pending work, derived from the explicitly managed overall progress value. */
export const progressSplit = (overall) => {
  const done = Math.min(100, Math.max(0, Number(overall) || 0));
  return { completed: done, pending: Math.round((100 - done) * 100) / 100 };
};
