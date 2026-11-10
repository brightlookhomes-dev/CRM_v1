import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import { AdminLayout, ProjectManagerLayout, CustomerLayout } from './layouts/Layouts.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import { AdminDashboard, AdminApprovals, AdminBills, AdminReceivables, AdminAuditLogs } from './pages/admin/AdminPages.jsx';
import { AdminProjects, AdminProjectPage } from './pages/admin/AdminProjects.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';
import { PMDashboard, PMProjects, PMProjectPage, PMBills } from './pages/pm/PMPages.jsx';
import { CustomerDashboard, CustomerProjectPage } from './pages/customer/CustomerPages.jsx';
import { ROLE_HOME } from './utils/format.js';

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RootRedirect />} />

      <Route element={<ProtectedRoute role="ADMIN" />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/projects" element={<AdminProjects />} />
          <Route path="/admin/projects/:id" element={<AdminProjectPage />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/approvals" element={<AdminApprovals />} />
          <Route path="/admin/bills" element={<AdminBills />} />
          <Route path="/admin/receivables" element={<AdminReceivables />} />
          <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute role="PROJECT_MANAGER" />}>
        <Route element={<ProjectManagerLayout />}>
          <Route path="/pm/dashboard" element={<PMDashboard />} />
          <Route path="/pm/projects" element={<PMProjects />} />
          <Route path="/pm/projects/:id" element={<PMProjectPage />} />
          <Route path="/pm/bills" element={<PMBills />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute role="CUSTOMER" />}>
        <Route element={<CustomerLayout />}>
          <Route path="/customer/dashboard" element={<CustomerDashboard />} />
          <Route path="/customer/projects/:id" element={<CustomerProjectPage />} />
        </Route>
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
