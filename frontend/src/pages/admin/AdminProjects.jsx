import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { errorMessage, toFormData, unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import { label } from '../../utils/format.js';
import { Modal, ConfirmDialog } from '../../components/common/Modal.jsx';
import { Async, Field, Pagination } from '../../components/common/ui.jsx';
import { FilePicker } from '../../components/common/Files.jsx';
import { ProjectCard } from '../../components/cards/Cards.jsx';
import { required, collect } from '../../utils/validators.js';
import StagePlanEditor, { fromServer, toPayload, validatePlan } from '../../features/stages/StagePlanEditor.jsx';
import PermanentDelete from '../../features/projects/PermanentDelete.jsx';
import ProjectView from '../shared/ProjectView.jsx';

const STATUSES = ['PLANNED', 'NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED'];

function MultiSelect({ label: l, options, value, onChange, id }) {
  return (
    <Field label={l} htmlFor={id}>
      <select id={id} multiple value={value} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))} style={{ minHeight: 90 }}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.fullName}</option>)}
      </select>
      <div className="small muted">Hold Ctrl/Cmd to select several</div>
    </Field>
  );
}

function ProjectFormModal({ project, onClose, onDone }) {
  const toast = useToast();
  const editing = !!project;
  const pms = useFetch(() => unwrap(api.get('/users?role=PROJECT_MANAGER&status=ACTIVE&limit=100')), []);
  const customers = useFetch(() => unwrap(api.get('/users?role=CUSTOMER&status=ACTIVE&limit=100')), []);
  const [f, setF] = useState({
    name: project?.name ?? '', location: project?.location ?? '', projectType: project?.projectType ?? '', description: project?.description ?? '',
    contractAmount: project?.contractAmount ?? '', startDate: project?.startDate ?? '', expectedCompletionDate: project?.expectedCompletionDate ?? '',
    status: project?.status ?? 'PLANNED', overallProgress: project?.overallProgress ?? 0,
  });
  const [pmIds, setPmIds] = useState(project?.projectManagers.map((m) => m.id) ?? []);
  const [custIds, setCustIds] = useState(project?.customers.map((m) => m.id) ?? []);
  const [plan, setPlan] = useState([]);
  const [planDirty, setPlanDirty] = useState(false);
  const existingStages = useFetch(() => (editing ? unwrap(api.get(`/projects/${project.id}/stages`)) : Promise.resolve({ data: null })), []);
  useEffect(() => { if (editing && existingStages.data) setPlan(fromServer(existingStages.data.stages)); }, [existingStages.data, editing]);
  const hasPlan = plan.length > 0;
  const changePlan = (next) => { setPlan(next); setPlanDirty(true); };
  const [cover, setCover] = useState([]);
  const [coverErr, setCoverErr] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const found = collect({
      name: required(f.name, 'Name'), location: required(f.location, 'Location'), projectType: required(f.projectType, 'Project type'),
      contractAmount: f.contractAmount !== '' && Number(f.contractAmount) < 0 ? 'Cannot be negative' : '',
      expectedCompletionDate: f.startDate && f.expectedCompletionDate && f.expectedCompletionDate < f.startDate ? 'Cannot be before start date' : '',
      plan: validatePlan(plan, f.startDate),
    });
    setErrors(found);
    if (Object.keys(found).length || coverErr) return;
    setBusy(true);
    try {
      const fields = { ...f, projectManagerIds: pmIds, customerIds: custIds };
      if (hasPlan) { delete fields.overallProgress; delete fields.expectedCompletionDate; } // both come from the stage plan
      if (editing) {
        await api.patch(`/projects/${project.id}`, toFormData(fields, { cover }));
        if (planDirty) await api.put(`/projects/${project.id}/stages`, { stages: toPayload(plan) });
      } else {
        await api.post('/projects', toFormData({ ...fields, stages: hasPlan ? toPayload(plan) : undefined }, { cover }));
      }
      toast.success(editing ? 'Project updated' : 'Project created');
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Edit project' : 'Create project'} onClose={onClose} size="wide">
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Project name" error={errors.name} htmlFor="p-name"><input autoComplete="off" id="p-name" value={f.name} onChange={set('name')} /></Field>
          <Field label="Location" error={errors.location} htmlFor="p-loc"><input autoComplete="off" id="p-loc" value={f.location} onChange={set('location')} /></Field>
          <Field label="Project type" error={errors.projectType} htmlFor="p-type"><input autoComplete="off" id="p-type" placeholder="Villa, Apartment…" value={f.projectType} onChange={set('projectType')} /></Field>
          <Field label="Contract amount (₹)" error={errors.contractAmount} htmlFor="p-amt"><input autoComplete="off" id="p-amt" type="number" min="0" value={f.contractAmount} onChange={set('contractAmount')} /></Field>
          {!hasPlan && <Field label="Expected completion" error={errors.expectedCompletionDate} htmlFor="p-end"><input autoComplete="off" id="p-end" type="date" value={f.expectedCompletionDate ?? ''} onChange={set('expectedCompletionDate')} /></Field>}
          <Field label="Status" htmlFor="p-status"><select id="p-status" value={f.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
          {!hasPlan && <Field label={`Overall progress: ${f.overallProgress}%`} htmlFor="p-prog"><input autoComplete="off" id="p-prog" type="range" min="0" max="100" value={f.overallProgress} onChange={set('overallProgress')} /></Field>}
          <MultiSelect id="p-pm" label="Project manager(s)" options={pms.data ?? []} value={pmIds} onChange={setPmIds} />
          <MultiSelect id="p-cust" label="Customer(s)" options={customers.data ?? []} value={custIds} onChange={setCustIds} />
        </div>
        <Field label="Description" htmlFor="p-desc"><textarea autoComplete="off" id="p-desc" rows={3} value={f.description ?? ''} onChange={set('description')} /></Field>
        {(!editing || existingStages.data) && <StagePlanEditor plan={plan} onChange={changePlan} startDate={f.startDate} onStartDateChange={(v) => setF((cur) => ({ ...cur, startDate: v }))} error={errors.plan} />}
        <FilePicker label={editing ? 'Replace cover photograph' : 'Cover photograph'} name="cover" accept="image/jpeg,image/png,image/webp" files={cover} error={coverErr} onChange={(x, p) => { setCover(x); setCoverErr(p); }} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn action" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminProjects() {
  const toast = useToast();
  const [filters, setFilters] = useState({ q: '', status: '', pmId: '', customerId: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page, limit: 12, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).toString();
  const { data, meta, loading, error, reload } = useFetch(() => unwrap(api.get(`/projects?${qs}`)), [qs]);
  const pms = useFetch(() => unwrap(api.get('/users?role=PROJECT_MANAGER&limit=100')), []);
  const customers = useFetch(() => unwrap(api.get('/users?role=CUSTOMER&limit=100')), []);
  const [editing, setEditing] = useState(null); // null | {} (new) | project
  const [deleting, setDeleting] = useState(null);
  const [purging, setPurging] = useState(null);
  const f =(k) => (e) => { setPage(1); setFilters({ ...filters, [k]: e.target.value }); };
  return (
    <div className="stack">
      <div className="row between"><h1>Manage projects</h1><button className="btn action" onClick={() => setEditing({})}>+ New project</button></div>
      <div className="row">
        <input autoComplete="off" aria-label="Search projects" placeholder="Search name, code, location…" value={filters.q} onChange={f('q')} style={{ maxWidth: 260 }} />
        <select aria-label="Status" value={filters.status} onChange={f('status')} style={{ width: 'auto' }}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select aria-label="Project manager" value={filters.pmId} onChange={f('pmId')} style={{ width: 'auto' }}><option value="">All PMs</option>{pms.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
        <select aria-label="Customer" value={filters.customerId} onChange={f('customerId')} style={{ width: 'auto' }}><option value="">All customers</option>{customers.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
      </div>
      <Async loading={loading} error={error} onRetry={reload} empty={data?.length === 0} emptyText="No projects match">
        <div className="grid cols-3">
          {data?.map((p) => (
            <div key={p.id} className="stack">
              <ProjectCard project={p} to={`/admin/projects/${p.id}`} showAdminInfo />
              <div className="row"><button className="btn sm ghost" onClick={() => setEditing(p)}>Edit</button><button className="btn sm ghost" onClick={() => setDeleting(p)}>Remove</button><button className="btn sm danger" onClick={() => setPurging(p)}>Delete permanently</button></div>
            </div>
          ))}
        </div>
        <Pagination meta={meta} onPage={setPage} />
      </Async>
      {editing && <ProjectFormModal project={editing.id ? editing : null} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {purging && <PermanentDelete kind="project" id={purging.id} name={purging.name} onCancel={() => setPurging(null)} onDeleted={() => { setPurging(null); reload(); }} />}
      {deleting && (
        <ConfirmDialog title="Remove project" danger confirmText="Remove" message={`Delete “${deleting.name}”? Projects with payments or bills cannot be deleted — archive them instead.`}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try { await api.delete(`/projects/${deleting.id}`); toast.success('Project deleted'); setDeleting(null); reload(); }
            catch (e) { toast.error(errorMessage(e)); setDeleting(null); }
          }} />
      )}
    </div>
  );
}

export const AdminProjectPage = () => {
  const { id } = useParams();
  return <ProjectView key={id} projectId={id} role="ADMIN" />;
};
