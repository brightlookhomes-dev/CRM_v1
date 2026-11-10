import { useEffect, useState } from 'react';
import api, { errorMessage, toFormData, unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Field } from '../../components/common/ui.jsx';
import { FilePicker } from '../../components/common/Files.jsx';
import { required, positive, percent, collect } from '../../utils/validators.js';

const TYPES = [['PROGRESS', 'Progress'], ['MATERIAL', 'Material'], ['APPROVAL_REQUEST', 'Request Approval']];
const blankOption = () => ({ label: '', priceNote: '', additionalCharge: '' });

export default function PostUpdateModal({ project, initialType = 'PROGRESS', onClose, onDone }) {
  const toast = useToast();
  const [type, setType] = useState(initialType);
  const [f, setF] = useState({ progressPercentage: Math.round(project.overallProgress), deliveryStatus: 'DELIVERED' });
  const [options, setOptions] = useState([blankOption(), blankOption()]);
  const [photos, setPhotos] = useState([]);
  const [docs, setDocs] = useState([]);
  const [fileErr, setFileErr] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const stagesQ = useFetch(() => unwrap(api.get(`/projects/${project.id}/stages`)), [project.id]);
  const stages = stagesQ.data?.stages ?? [];
  const staged = stages.length > 0;
  const stage = stages.find((s) => s.id === f.stageId);
  // Default to the first unfinished stage once the plan loads.
  useEffect(() => {
    if (!stages.length || f.stageId) return;
    const s = stages.find((x) => x.status !== 'COMPLETED') ?? stages[0];
    setF((cur) => ({ ...cur, stageId: s.id, progressPercentage: Math.round(s.completionPercent) }));
  }, [stages, f.stageId]);
  const overallPreview = staged && stage
    ? Math.round(stages.reduce((sum, s) => sum + (s.weightPercent * (s.id === stage.id ? Number(f.progressPercentage) : s.completionPercent)) / 100, 0) * 100) / 100
    : null;
  const pickStage = (e) => { const s = stages.find((x) => x.id === e.target.value); setF({ ...f, stageId: s.id, progressPercentage: Math.round(s.completionPercent) }); };

  const validate = () => {
    const c = { description: type === 'PROGRESS' || type === 'GENERAL' ? required(f.description, 'Description') : '' };
    if (type === 'PROGRESS') { c.progressPercentage = percent(f.progressPercentage); if (staged && !f.stageId) c.stageId = 'Select the stage you are updating'; }
    if (type === 'MATERIAL') Object.assign(c, { materialName: required(f.materialName, 'Material name'), quantity: positive(f.quantity, 'Quantity'), unit: required(f.unit, 'Unit') });
    if (type === 'APPROVAL_REQUEST') {
      c.title = required(f.title, 'Decision title');
      if (options.filter((o) => o.label.trim()).length < 2) c.options = 'Provide at least two options';
    }
    return collect(c);
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length || fileErr.photos || fileErr.docs) return;
    setBusy(true);
    try {
      const body = { ...f, type };
      if (type !== 'PROGRESS' || !staged) delete body.stageId;
      if (type === 'APPROVAL_REQUEST') {
        body.options = options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), priceNote: o.priceNote || undefined, additionalCharge: o.additionalCharge === '' ? undefined : Number(o.additionalCharge) }));
        if (f.deadline) body.deadline = new Date(`${f.deadline}T23:59:59`).toISOString();
      }
      await api.post(`/projects/${project.id}/updates`, toFormData(body, { photos, documents: docs }));
      toast.success('Update posted — the customer can see it now');
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Post update — ${project.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="tabs" role="tablist">
          {TYPES.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={type === k} className={type === k ? 'active' : ''} onClick={() => { setType(k); setErrors({}); }}>{l}</button>)}
        </div>

        {type === 'PROGRESS' && (<>
          {staged && (
            <Field label="Construction stage" error={errors.stageId} htmlFor="pstage">
              <select id="pstage" value={f.stageId ?? ''} onChange={pickStage}>
                {stages.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.name} ({Math.round(s.weightPercent)}% of project){s.status === 'COMPLETED' ? ' ✓' : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label={staged ? `Stage completion: ${f.progressPercentage}%` : `Overall progress: ${f.progressPercentage}%`} error={errors.progressPercentage} htmlFor="pp">
            <input autoComplete="off" id="pp" type="range" min="0" max="100" value={f.progressPercentage} onChange={set('progressPercentage')} />
            {staged && overallPreview !== null && <div className="small muted">Overall project progress will become <strong>{overallPreview}%</strong>.</div>}
          </Field>
          <Field label="Work completed" htmlFor="wc"><textarea autoComplete="off" id="wc" rows={2} onChange={set('workCompleted')} /></Field>
          <Field label="Work remaining" htmlFor="wr"><textarea autoComplete="off" id="wr" rows={2} onChange={set('workRemaining')} /></Field>
        </>)}

        {type === 'MATERIAL' && (<div className="form-grid">
          <Field label="Material name" error={errors.materialName} htmlFor="mn"><input autoComplete="off" id="mn" onChange={set('materialName')} /></Field>
          <Field label="Supplier (optional)" htmlFor="sp"><input autoComplete="off" id="sp" onChange={set('supplier')} /></Field>
          <Field label="Quantity" error={errors.quantity} htmlFor="qt"><input autoComplete="off" id="qt" type="number" min="0" step="any" onChange={set('quantity')} /></Field>
          <Field label="Unit" error={errors.unit} htmlFor="un"><input autoComplete="off" id="un" placeholder="bags, tons, nos…" onChange={set('unit')} /></Field>
          <Field label="Delivery status" htmlFor="ds">
            <select id="ds" value={f.deliveryStatus} onChange={set('deliveryStatus')}>
              {['ORDERED', 'IN_TRANSIT', 'DELIVERED', 'PARTIAL', 'REJECTED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Delivery date" htmlFor="dd"><input autoComplete="off" id="dd" type="date" onChange={set('deliveryDate')} /></Field>
        </div>)}

        {type === 'APPROVAL_REQUEST' && (<>
          <Field label="What should the customer decide?" error={errors.title} htmlFor="dt"><input autoComplete="off" id="dt" onChange={set('title')} /></Field>
          <div className="form-grid">
            <Field label="Category" htmlFor="dc"><input autoComplete="off" id="dc" placeholder="e.g. Finishes" onChange={set('decisionCategory')} /></Field>
            <Field label="Customer deadline (optional)" htmlFor="dl"><input autoComplete="off" id="dl" type="date" onChange={set('deadline')} /></Field>
          </div>
          <label>Options</label>
          {options.map((o, i) => (
            <div key={i} className="form-grid" style={{ marginBottom: '.4rem' }}>
              <input autoComplete="off" aria-label={`Option ${i + 1} name`} placeholder={`Option ${i + 1}`} value={o.label} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input autoComplete="off" aria-label={`Option ${i + 1} price note`} placeholder="Price note (e.g. +₹180/sq.ft.)" value={o.priceNote} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, priceNote: e.target.value } : x)))} />
            </div>
          ))}
          {errors.options && <div className="error-text">{errors.options}</div>}
          <button type="button" className="btn ghost sm" onClick={() => setOptions([...options, blankOption()])}>+ Add option</button>
          <label className="row small" style={{ fontWeight: 400, marginTop: '.6rem' }}>
            <input autoComplete="off" type="checkbox" style={{ width: 'auto' }} onChange={(e) => setF({ ...f, requiresAdminApproval: e.target.checked })} /> Needs final admin approval after the customer responds
          </label>
          <Field label="Supporting details" htmlFor="det"><textarea autoComplete="off" id="det" rows={2} onChange={set('details')} /></Field>
        </>)}

        <Field label={type === 'APPROVAL_REQUEST' ? 'Description' : 'Description'} error={errors.description} htmlFor="desc">
          <textarea autoComplete="off" id="desc" rows={3} onChange={set('description')} />
        </Field>
        <FilePicker label="Photos (max 4)" name="photos" multiple max={4} accept="image/jpeg,image/png,image/webp" files={photos} error={fileErr.photos}
          onChange={(files, p) => { setPhotos(files); setFileErr((x) => ({ ...x, photos: p })); }} />
        {type !== 'APPROVAL_REQUEST' && (
          <FilePicker label="Supporting documents (optional)" name="docs" multiple max={6} files={docs} error={fileErr.docs}
            onChange={(files, p) => { setDocs(files); setFileErr((x) => ({ ...x, docs: p })); }} />
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn action" disabled={busy}>{busy ? 'Posting…' : 'Post update'}</button>
        </div>
      </form>
    </Modal>
  );
}
