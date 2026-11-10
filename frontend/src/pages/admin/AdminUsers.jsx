import { useState } from 'react';
import api, { errorMessage, unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fmtDateTime, label } from '../../utils/format.js';
import { Modal, ConfirmDialog } from '../../components/common/Modal.jsx';
import { Async, Field, Pagination, StatusBadge } from '../../components/common/ui.jsx';
import { minLen, collect } from '../../utils/validators.js';
import PermanentDelete from '../../features/projects/PermanentDelete.jsx';

function UserFormModal({ user, onClose, onDone }) {
  const toast = useToast();
  const editing = !!user;
  const projects = useFetch(() => unwrap(api.get('/projects?limit=100')), []);
  const [f, setF] = useState({ fullName: user?.fullName ?? '', username: '', email: user?.email ?? '', phone: user?.phone ?? '', password: '', role: user?.role ?? 'CUSTOMER' });
  const [projectIds, setProjectIds] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const found = collect({
      fullName: minLen(f.fullName, 2, 'Full name'),
      ...(editing ? {} : { username: minLen(f.username, 3, 'Username'), password: minLen(f.password, 8, 'Password') }),
      email: f.email && !/^\S+@\S+\.\S+$/.test(f.email) ? 'Enter a valid email' : '',
    });
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (editing) await api.patch(`/users/${user.id}`, { fullName: f.fullName, email: f.email || null, phone: f.phone || null, role: f.role });
      else await api.post('/users', { ...f, email: f.email || undefined, phone: f.phone || undefined, projectIds: f.role === 'ADMIN' ? undefined : projectIds });
      toast.success(editing ? 'User updated' : 'User created');
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? `Edit ${user.username}` : 'Create login'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Full name" error={errors.fullName} htmlFor="u-name"><input autoComplete="off" id="u-name" value={f.fullName} onChange={set('fullName')} /></Field>
          {!editing && <Field label="Username / Login ID" error={errors.username} htmlFor="u-user"><input id="u-user" autoComplete="off" onChange={set('username')} /></Field>}
          <Field label="Email" error={errors.email} htmlFor="u-email"><input autoComplete="off" id="u-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Phone" htmlFor="u-phone"><input autoComplete="off" id="u-phone" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Role" htmlFor="u-role"><select id="u-role" value={f.role} onChange={set('role')}>{['CUSTOMER', 'PROJECT_MANAGER', 'ADMIN'].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></Field>
          {!editing && <Field label="Initial password" error={errors.password} htmlFor="u-pw"><input id="u-pw" type="password" autoComplete="new-password" onChange={set('password')} /></Field>}
        </div>
        {!editing && f.role !== 'ADMIN' && (
          <Field label="Assign projects (optional)" htmlFor="u-proj">
            <select id="u-proj" multiple value={projectIds} onChange={(e) => setProjectIds([...e.target.selectedOptions].map((o) => o.value))} style={{ minHeight: 90 }}>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn action" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function UserDetailModal({ id, onClose }) {
  const { data, loading, error } = useFetch(() => unwrap(api.get(`/users/${id}`)), [id]);
  return (
    <Modal title="User activity & access" onClose={onClose}>
      <Async loading={loading} error={error}>
        <h3>Project access</h3>
        {data?.assignments.length ? data.assignments.map((a) => <div key={a.id} className="small">{a.projectName} <span className="muted">({a.projectCode})</span></div>) : <div className="small muted">None</div>}
        <h3 style={{ marginTop: '1rem' }}>Recent activity</h3>
        {data?.recentActivity.map((a) => <div key={a.id} className="small">{fmtDateTime(a.createdAt)} — {a.description}</div>)}
      </Async>
    </Modal>
  );
}

export default function AdminUsers() {
  const toast = useToast();
  const [filters, setFilters] = useState({ q: '', role: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page, limit: 15, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).toString();
  const { data, meta, loading, error, reload } = useFetch(() => unwrap(api.get(`/users?${qs}`)), [qs]);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [tempPw, setTempPw] = useState(null);
  return (
    <div className="stack">
      <div className="row between"><h1>Manage logins</h1><button className="btn action" onClick={() => setForm({})}>+ New login</button></div>
      <div className="row">
        <input autoComplete="off" aria-label="Search users" placeholder="Search…" value={filters.q} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} style={{ maxWidth: 260 }} />
        <select aria-label="Role" value={filters.role} onChange={(e) => { setPage(1); setFilters({ ...filters, role: e.target.value }); }} style={{ width: 'auto' }}>
          <option value="">All roles</option>{['ADMIN', 'PROJECT_MANAGER', 'CUSTOMER'].map((r) => <option key={r} value={r}>{label(r)}</option>)}
        </select>
      </div>
      <Async loading={loading} error={error} onRetry={reload} empty={data?.length === 0} emptyText="No users found">
        <div className="card table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Projects</th><th>Status</th><th>Last login</th><th /></tr></thead>
          <tbody>{data?.map((u) => (
            <tr key={u.id}>
              <td><strong>{u.fullName}</strong><div className="small muted">{u.email}</div></td><td>{u.username}</td><td>{label(u.role)}</td><td>{u.projectCount}</td>
              <td><StatusBadge status={u.status} /></td><td className="small">{fmtDateTime(u.lastLoginAt)}</td>
              <td><div className="row">
                <button className="btn sm ghost" onClick={() => setForm(u)}>Edit</button>
                <button className="btn sm ghost" onClick={() => setDetail(u.id)}>Activity</button>
                <button className="btn sm ghost" onClick={() => setConfirm({ type: 'reset', u })}>Reset password</button>
                <button className="btn sm ghost" onClick={() => setConfirm({ type: 'status', u })}>{u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>
                <button className="btn sm danger" onClick={() => setConfirm({ type: 'purge', u })}>Delete</button>
              </div></td>
            </tr>))}</tbody>
        </table></div>
        <Pagination meta={meta} onPage={setPage} />
      </Async>
      {form && <UserFormModal user={form.id ? form : null} onClose={() => setForm(null)} onDone={() => { setForm(null); reload(); }} />}
      {detail && <UserDetailModal id={detail} onClose={() => setDetail(null)} />}
      {confirm?.type === 'status' && (
        <ConfirmDialog title={`${confirm.u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} account`} message={`${confirm.u.fullName} (${confirm.u.username})`} danger={confirm.u.status === 'ACTIVE'} onCancel={() => setConfirm(null)}
          onConfirm={async () => { try { await api.patch(`/users/${confirm.u.id}/status`, { status: confirm.u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); toast.success('Status updated'); setConfirm(null); reload(); } catch (e) { toast.error(errorMessage(e)); setConfirm(null); } }} />
      )}
      {confirm?.type === 'reset' && (
        <ConfirmDialog title="Reset password" message={`Generate a new temporary password for ${confirm.u.fullName}? All their sessions will be signed out.`} confirmText="Reset" onCancel={() => setConfirm(null)}
          onConfirm={async () => { try { const r = await api.post(`/users/${confirm.u.id}/reset-password`, {}); setTempPw(r.data.data.temporaryPassword); setConfirm(null); } catch (e) { toast.error(errorMessage(e)); setConfirm(null); } }} />
      )}
      {confirm?.type === 'purge' && <PermanentDelete kind="user" id={confirm.u.id} name={confirm.u.fullName} onCancel={() => setConfirm(null)} onDeleted={() => { setConfirm(null); reload(); }} />}
      {tempPw && (
        <Modal title="Temporary password" onClose={() => setTempPw(null)} size="small">
          <p>Share this with the user securely. It is shown only once.</p>
          <pre className="diff" style={{ fontSize: '1rem' }}>{tempPw}</pre>
          <button className="btn" onClick={() => setTempPw(null)}>Done</button>
        </Modal>
      )}
    </div>
  );
}
