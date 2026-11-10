import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { errorMessage } from '../../services/api.js';
import { AuthLayout } from '../../layouts/Layouts.jsx';
import { Field } from '../../components/common/ui.jsx';
import { required, collect } from '../../utils/validators.js';
import { ROLE_HOME } from '../../utils/format.js';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [form, setForm] = useState({ username: '', password: '', remember: false });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  const submit = async (e) => {
    e.preventDefault();
    const found = collect({ username: required(form.username, 'Username'), password: required(form.password, 'Password') });
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true); setServerError('');
    try {
      const u = await login(form.username.trim(), form.password, form.remember);
      const from = location.state?.from;
      const portal = `/${ROLE_HOME[u.role].split('/')[1]}`;
      navigate(from?.startsWith(portal) ? from : ROLE_HOME[u.role], { replace: true });
    } catch (err) {
      setServerError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <form className="card login-card" onSubmit={submit} noValidate>
        <div className="brand" style={{ fontSize: '1.5rem', marginBottom: '.2rem' }}>Bright<span>look</span> Homes</div>
        <p className="muted">Sign in to your portal</p>
        {serverError && <div className="alert" role="alert" style={{ marginBottom: '.8rem' }}>{serverError}</div>}
        <Field label="Username / Login ID" error={errors.username} htmlFor="username">
          <input id="username" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus />
        </Field>
        <Field label="Password" error={errors.password} htmlFor="password">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="button" className="btn ghost sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </Field>
        <label className="row small" style={{ fontWeight: 400 }}>
          <input autoComplete="off" type="checkbox" style={{ width: 'auto' }} checked={form.remember} onChange={(e) => setForm({ ...form, remember: e.target.checked })} /> Remember me
        </label>
        <button className="btn" style={{ width: '100%', marginTop: '1rem' }} disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button>
      </form>
    </AuthLayout>
  );
}
