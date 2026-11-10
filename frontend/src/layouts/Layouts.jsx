import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import api, { unwrap } from '../services/api.js';
import { fmtDateTime } from '../utils/format.js';

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data, meta, reload } = useFetch(() => unwrap(api.get('/notifications?limit=10')), []);
  const markAll = async () => { await api.patch('/notifications/read-all'); reload(); };
  return (
    <div style={{ position: 'relative' }}>
      <button className="bell" aria-label={`Notifications (${meta?.unreadCount ?? 0} unread)`} onClick={() => { setOpen((o) => !o); reload(); }}>
        🔔{meta?.unreadCount > 0 && <span className="dot">{meta.unreadCount}</span>}
      </button>
      {open && (
        <div className="card dropdown">
          <div className="row between"><strong>Notifications</strong><button className="btn sm ghost" onClick={markAll}>Mark all read</button></div>
          {!data?.length && <div className="empty small">No notifications</div>}
          {data?.map((n) => (
            <div key={n.id} style={{ padding: '.5rem 0', borderTop: '1px solid var(--border)', opacity: n.isRead ? 0.6 : 1 }}>
              <div><strong className="small">{n.title}</strong></div>
              {n.message && <div className="small">{n.message}</div>}
              <div className="small muted">{fmtDateTime(n.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ links }) {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">Bright<span>look</span> Homes</div>
          <nav className="nav" aria-label="Main">
            {links.map(([to, text]) => <NavLink key={to} to={to}>{text}</NavLink>)}
          </nav>
          <NotificationBell />
          <span className="small muted user-name">{user.fullName}</span>
          <button className="btn ghost sm" onClick={logout}>Logout</button>
        </div>
      </header>
      <main className="container"><Outlet /></main>
    </>
  );
}

export const AdminLayout = () => (
  <Shell links={[['/admin/dashboard', 'Dashboard'], ['/admin/projects', 'Projects'], ['/admin/users', 'Logins'], ['/admin/approvals', 'Approvals'], ['/admin/bills', 'Bills'], ['/admin/receivables', 'Receivables'], ['/admin/audit-logs', 'Audit Logs']]} />
);
export const ProjectManagerLayout = () => (
  <Shell links={[['/pm/dashboard', 'Dashboard'], ['/pm/projects', 'Projects'], ['/pm/bills', 'Bills']]} />
);
export const CustomerLayout = () => <Shell links={[['/customer/dashboard', 'My Projects']]} />;
export const AuthLayout = ({ children }) => <div className="login-wrap">{children}</div>;
