import { useMemo, useState } from 'react';
import api, { errorMessage, unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import { addDays, diffDays, fmtShort, latestEnd, monthTitle, monthWeeks, scheduleStages, todayIso } from '../../utils/dates.js';
import { label, pct } from '../../utils/format.js';
import { Modal, ConfirmDialog } from '../../components/common/Modal.jsx';
import { Async, Field, ProgressBar, StatusBadge } from '../../components/common/ui.jsx';
import { DelayImpact, DelayLog, SchedulePill, TimingChip } from './StageBits.jsx';

// Light stage colours (soft background, dark text, slightly deeper "done so far" fill).
const PALETTE = [
  { bg: '#D7F0F6', fg: '#0b5565', fill: '#9edbe8' }, { bg: '#FDE5D4', fg: '#7a3308', fill: '#f7c19b' },
  { bg: '#E8E1FB', fg: '#40318a', fill: '#c7b9f3' }, { bg: '#FCF0CF', fg: '#6b4a05', fill: '#f3da8b' },
  { bg: '#FBDDE8', fg: '#7f1d45', fill: '#f2b3cb' }, { bg: '#DCE6FB', fg: '#1e3a8a', fill: '#b3c6f3' },
  { bg: '#E3F1D8', fg: '#2f5d12', fill: '#bfe0a2' }, { bg: '#D6F3EE', fg: '#0d5c52', fill: '#a3e0d6' },
];
const DONE = { bg: '#D9F2E1', fg: '#14532d', fill: '#a6dfb8' };
const RED = { bg: '#FBD5D8', fg: '#8a1624', line: '#e57b86' };
const HATCH = 'repeating-linear-gradient(45deg, #fdecee, #fdecee 6px, #f6c6cc 6px, #f6c6cc 12px)';

export const EVENT_TYPES = [
  { value: 'DEADLINE', label: 'Deadline', icon: '🚩', color: '#DC3545' },
  { value: 'MEETING', label: 'Meeting', icon: '👥', color: '#4263eb' },
  { value: 'DELIVERY', label: 'Material delivery', icon: '🚚', color: '#B94B0D' },
  { value: 'INSPECTION', label: 'Inspection', icon: '🔍', color: '#198754' },
  { value: 'OTHER', label: 'Other', icon: '📌', color: '#746F69' },
];
const typeOf = (v) => EVENT_TYPES.find((t) => t.value === v) ?? EVENT_TYPES[4];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A stage is drawn as up to three parts: planned (soft colour), delay beyond the baseline (red), overdue until today (red hatch). */
function segmentsOf(stage, today) {
  const segs = [];
  const done = stage.status === 'COMPLETED';
  const be = stage.baselineEnd;
  const delayed = be && stage.plannedEnd > be;
  const normalEnd = delayed ? (be < stage.plannedStart ? null : be) : stage.plannedEnd;
  if (normalEnd) segs.push({ kind: 'normal', start: stage.plannedStart, end: normalEnd });
  if (delayed) segs.push({ kind: 'delay', start: be < stage.plannedStart ? stage.plannedStart : addDays(be, 1), end: stage.plannedEnd });
  if (!done && today > stage.plannedEnd) segs.push({ kind: 'overdue', start: addDays(stage.plannedEnd, 1), end: today });
  return segs;
}

/** Slice every stage's parts to one week and give each stage a lane, so overlapping stages stack. */
function barsForWeek(stages, week, today) {
  const lanes = [];
  const out = [];
  stages.forEach((s, i) => {
    const slices = segmentsOf(s, today).filter((g) => g.end >= week[0] && g.start <= week[6])
      .map((g) => ({ ...g, from: Math.max(0, diffDays(week[0], g.start)), to: Math.min(6, diffDays(week[0], g.end)) }));
    if (!slices.length) return;
    const lo = Math.min(...slices.map((g) => g.from)); const hi = Math.max(...slices.map((g) => g.to));
    let lane = lanes.findIndex((end) => end < lo);
    if (lane === -1) { lane = lanes.length; lanes.push(hi); } else lanes[lane] = hi;
    slices.forEach((g, k) => out.push({ s, i, g, lane, labelled: k === 0 }));
  });
  return out;
}

function barStyle(s, i, g) {
  const base = { gridColumn: `${g.from + 1} / span ${g.to - g.from + 1}` };
  if (g.kind === 'delay') return { ...base, background: RED.bg, color: RED.fg, boxShadow: `inset 0 0 0 1px ${RED.line}` };
  if (g.kind === 'overdue') return { ...base, background: HATCH, color: RED.fg, boxShadow: `inset 0 0 0 1px ${RED.line}` };
  const c = s.status === 'COMPLETED' ? DONE : PALETTE[i % PALETTE.length];
  // Deeper shade over the part already completed, so the bar itself shows progress.
  const doneDays = Math.round((s.durationDays * Number(s.completionPercent)) / 100);
  const lastDone = doneDays > 0 ? addDays(s.plannedStart, doneDays - 1) : null;
  const span = diffDays(g.start, g.end) + 1;
  const filled = lastDone && lastDone >= g.start ? Math.min(span, diffDays(g.start, lastDone) + 1) : 0;
  const p = (filled / span) * 100;
  return { ...base, color: c.fg, background: `linear-gradient(90deg, ${c.fill} ${p}%, ${c.bg} ${p}%)`, boxShadow: `inset 0 0 0 1px ${c.fill}` };
}

function EventModal({ projectId, event, date, onClose, onDone }) {
  const toast = useToast();
  const editing = !!event;
  const [f, setF] = useState({ title: event?.title ?? '', eventType: event?.eventType ?? 'DEADLINE', startDate: event?.startDate ?? date ?? todayIso(), endDate: event?.endDate ?? '', notes: event?.notes ?? '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (f.title.trim().length < 2) found.title = 'Title is required';
    if (!f.startDate) found.startDate = 'Date is required';
    if (f.endDate && f.endDate < f.startDate) found.endDate = 'End cannot be before the start date';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const body = { title: f.title.trim(), eventType: f.eventType, startDate: f.startDate, endDate: f.endDate || (editing ? null : undefined), notes: f.notes.trim() || (editing ? null : undefined) };
      if (editing) await api.patch(`/projects/${projectId}/events/${event.id}`, body); else await api.post(`/projects/${projectId}/events`, body);
      toast.success(editing ? 'Calendar item updated' : 'Calendar item added');
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Edit calendar item' : 'Add calendar item'} onClose={onClose} size="small">
      <form onSubmit={submit} noValidate>
        <Field label="Title" error={errors.title} htmlFor="ev-title"><input autoComplete="off" id="ev-title" value={f.title} onChange={set('title')} placeholder="e.g. Slab casting deadline" autoFocus /></Field>
        <Field label="Type" htmlFor="ev-type"><select id="ev-type" value={f.eventType} onChange={set('eventType')}>{EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}</select></Field>
        <div className="form-grid">
          <Field label="Date" error={errors.startDate} htmlFor="ev-start"><input autoComplete="off" id="ev-start" type="date" value={f.startDate} onChange={set('startDate')} /></Field>
          <Field label="Until (optional)" error={errors.endDate} htmlFor="ev-end"><input autoComplete="off" id="ev-end" type="date" min={f.startDate} value={f.endDate} onChange={set('endDate')} /></Field>
        </div>
        <Field label="Notes" htmlFor="ev-notes"><textarea autoComplete="off" id="ev-notes" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="row between">
          <div>{editing && <button type="button" className="btn danger sm" onClick={() => setConfirmDelete(true)}>Delete</button>}</div>
          <div className="row"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn action" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
        </div>
      </form>
      {confirmDelete && (
        <ConfirmDialog title="Delete calendar item?" danger confirmText="Delete" message={`Remove “${event.title}” from the calendar?`} onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => { try { await api.delete(`/projects/${projectId}/events/${event.id}`); toast.success('Calendar item removed'); onDone(); } catch (err) { toast.error(errorMessage(err)); setConfirmDelete(false); } }} />
      )}
    </Modal>
  );
}

/** Change a stage's deadline. Pushing it later is a delay: a reason is required and gets logged. */
function StageModal({ projectId, stages, delays, stage, onClose, onDone }) {
  const toast = useToast();
  const idx = stages.findIndex((s) => s.id === stage.id);
  const [end, setEnd] = useState(stage.plannedEnd);
  const [start, setStart] = useState(stage.plannedStart);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const duration = Math.max(0, diffDays(start, end) + 1);
  const projectStart = stages[0].plannedStart;
  const delaying = !!end && duration >= 1 && end > stage.plannedEnd;
  const error = !start || !end ? 'Pick both dates' : duration < 1 ? 'End date cannot be before the start date' : idx > 0 && start < projectStart ? `Cannot start before the project starts (${fmtShort(projectStart)})` : '';
  const preview = useMemo(() => {
    if (error) return null;
    const tail = scheduleStages(start, [{ durationDays: duration }, ...stages.slice(idx + 1).map((s) => ({ durationDays: s.durationDays, startOffsetDays: s.startOffsetDays }))]);
    const shifted = tail.slice(1).filter((t, i) => t.plannedStart !== stages[idx + 1 + i].plannedStart).length;
    const after = [...stages.slice(0, idx), ...tail];
    return { shifted, completion: latestEnd(after), days: diffDays(latestEnd(stages), latestEnd(after)) };
  }, [error, start, duration, stages, idx]);
  const changed = start !== stage.plannedStart || end !== stage.plannedEnd;
  const needReason = delaying && reason.trim().length < 3;
  const history = delays.filter((d) => d.stageId === stage.id);

  const save = async (e) => {
    e.preventDefault();
    if (error || !changed || needReason) return;
    setBusy(true);
    try {
      const body = { plannedEnd: end, reason: reason.trim() || undefined };
      if (start !== stage.plannedStart) body.plannedStart = start;
      const r = await api.patch(`/projects/${projectId}/stages/${stage.id}/schedule`, body);
      toast.success(`Timeline updated${r.data.data.shiftedStages ? ` — ${r.data.data.shiftedStages} later stage(s) shifted` : ''}`);
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Stage ${idx + 1}: ${stage.name}`} onClose={onClose} size="small">
      <div className="row small" style={{ marginBottom: '.6rem' }}><StatusBadge status={stage.status} /><TimingChip timing={stage.timing} /><span>{pct(stage.completionPercent)} complete</span><span className="muted">· {pct(stage.weightPercent)} of project</span></div>
      <form onSubmit={save} noValidate>
        <div className="form-grid">
          <Field label="Start date" htmlFor="st-start"><input autoComplete="off" id="st-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Deadline (end date)" htmlFor="st-end"><input autoComplete="off" id="st-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <p className="small">Duration: <strong>{duration || '—'} days</strong> (was {stage.durationDays})</p>
        {error && <div className="error-text" role="alert">{error}</div>}
        {preview && changed && (
          <div className="alert" style={delaying ? undefined : { background: 'var(--primary-tint)', color: '#0a5f70' }}>
            {delaying && <strong>This is a delay. </strong>}
            {preview.shifted > 0 ? `${preview.shifted} later stage(s) will shift. ` : 'No later stages are affected. '}
            Project completion: <strong>{fmtShort(preview.completion)}</strong>{preview.days !== 0 && ` (${preview.days > 0 ? '+' : ''}${preview.days} days)`}.
          </div>
        )}
        <Field label={delaying ? 'Reason for the delay (required)' : 'Note (optional)'} htmlFor="st-reason">
          <textarea autoComplete="off" id="st-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rain, material shortage, approval pending" />
          <div className="small muted">Shared with the project manager and customer.</div>
        </Field>
        {history.length > 0 && <details style={{ marginBottom: '.8rem' }}><summary className="small" style={{ cursor: 'pointer' }}>Earlier delays for this stage ({history.length})</summary><div style={{ marginTop: '.4rem' }}><DelayLog delays={history} /></div></details>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn action" disabled={busy || !!error || !changed || needReason}>{busy ? 'Saving…' : 'Update timeline'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Tick a stage off: choose when it finished; shows whether that is on time, early or late. */
function CompleteModal({ projectId, stage, onClose, onDone }) {
  const toast = useToast();
  const [on, setOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const late = diffDays(stage.plannedEnd, on);
  const save = async () => {
    setBusy(true);
    try { await api.post(`/projects/${projectId}/stages/${stage.id}/complete`, { completed: true, completedOn: on }); toast.success(`${stage.name} marked complete`); onDone(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Mark “${stage.name}” complete`} onClose={onClose} size="small">
      <Field label="Completed on" htmlFor="done-on"><input autoComplete="off" id="done-on" type="date" max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} /></Field>
      <div className="alert" style={late > 0 ? undefined : { background: '#e3f4ea', color: '#14532d' }}>
        Planned deadline: {fmtShort(stage.plannedEnd)} — {late > 0 ? <strong>{late} day{late > 1 ? 's' : ''} late</strong> : late < 0 ? <strong>{-late} day{late < -1 ? 's' : ''} early</strong> : <strong>on time</strong>}.
        <div className="small">The stage goes to 100% and the project’s overall progress updates.</div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: '.8rem' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn action" disabled={busy || !on} onClick={save}>{busy ? 'Saving…' : 'Mark complete'}</button>
      </div>
    </Modal>
  );
}

function MonthGrid({ year, month, stages, events, today, onStage, onDay, onEvent }) {
  const weeks = useMemo(() => monthWeeks(year, month), [year, month]);
  const eventsOn = (d) => events.filter((e) => e.startDate <= d && d <= (e.endDate ?? e.startDate));
  return (
    <div className="card" style={{ padding: '.6rem' }}>
      <h3 style={{ margin: '0 0 .3rem .3rem' }}>{monthTitle(year, month)}</h3>
      <div className="table-wrap">
        <div className="cal" role="grid" aria-label={`Calendar ${monthTitle(year, month)}`}>
          <div className="cal-head">{WEEKDAYS.map((d) => <div key={d}>{d}</div>)}</div>
          {weeks.map((week) => (
            <div className="cal-week" key={week[0]}>
              <div className="cal-bars">
                {barsForWeek(stages, week, today).map(({ s, i, g, lane, labelled }) => (
                  <button key={`${s.id}-${g.kind}`} className="cal-bar" style={{ ...barStyle(s, i, g), gridRow: lane + 1 }} onClick={() => onStage(s)}
                    title={`${s.name}: ${fmtShort(s.plannedStart)} → ${fmtShort(s.plannedEnd)} · ${pct(s.completionPercent)} done${g.kind === 'delay' ? ' · delayed beyond the original plan' : g.kind === 'overdue' ? ' · overdue' : ''} — click to edit`}>
                    {labelled && <>{g.kind === 'delay' ? '⚠ delay' : g.kind === 'overdue' ? '⚠ overdue' : <>{s.status === 'COMPLETED' ? '✓ ' : ''}{s.name}</>}</>}
                  </button>
                ))}
              </div>
              <div className="cal-days">
                {week.map((d) => {
                  const inMonth = new Date(`${d}T00:00:00Z`).getUTCMonth() === month;
                  return (
                    <div key={d} role="gridcell" className={`cal-day ${inMonth ? '' : 'out'} ${d === today ? 'today' : ''}`} onClick={() => onDay(d)}>
                      <span className="cal-num">{Number(d.slice(8))}</span>
                      {eventsOn(d).map((e) => (
                        <button key={e.id} className="cal-chip" style={{ borderLeftColor: typeOf(e.eventType).color }} title={`${typeOf(e.eventType).label}: ${e.title}`}
                          onClick={(ev) => { ev.stopPropagation(); onEvent(e); }}>{typeOf(e.eventType).icon} {e.title}</button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CalendarPanel({ projectId, onChanged }) {
  const toast = useToast();
  const stagesQ = useFetch(() => unwrap(api.get(`/projects/${projectId}/stages`)), [projectId]);
  const eventsQ = useFetch(() => unwrap(api.get(`/projects/${projectId}/events`)), [projectId]);
  const stages = stagesQ.data?.stages ?? [];
  const delays = stagesQ.data?.delays ?? [];
  const events = eventsQ.data ?? [];
  const today = todayIso();
  const [months, setMonths] = useState(2);
  const [cursor, setCursor] = useState(null);
  const [eventModal, setEventModal] = useState(null);
  const [stageModal, setStageModal] = useState(null);
  const [completeModal, setCompleteModal] = useState(null);
  const [reopen, setReopen] = useState(null);

  // Open on the month that matters: today if the project is running, otherwise where it starts.
  const anchor = stages.length ? (today >= stages[0].plannedStart && today <= latestEnd(stages) ? today : stages[0].plannedStart) : today;
  const cur = cursor ?? { y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 };
  const monthAt = (offset) => { const t = new Date(Date.UTC(cur.y, cur.m + offset, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; };
  const shown = Array.from({ length: months }, (_, k) => monthAt(k));
  const jump = (dateStr) => setCursor({ y: Number(dateStr.slice(0, 4)), m: Number(dateStr.slice(5, 7)) - 1 });
  const refresh = () => { stagesQ.reload(); eventsQ.reload(); onChanged?.(); };
  const title = months === 1 ? monthTitle(shown[0].y, shown[0].m) : `${monthTitle(shown[0].y, shown[0].m)} – ${monthTitle(shown[months - 1].y, shown[months - 1].m)}`;
  const colorOf = (i) => PALETTE[i % PALETTE.length];

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <button className="btn sm ghost" aria-label="Previous month" onClick={() => setCursor(monthAt(-1))}>‹</button>
          <h2 style={{ margin: 0, minWidth: 210, textAlign: 'center' }}>{title}</h2>
          <button className="btn sm ghost" aria-label="Next month" onClick={() => setCursor(monthAt(1))}>›</button>
          <button className="btn sm ghost" onClick={() => jump(today)}>Today</button>
          {stages[0] && <button className="btn sm ghost" onClick={() => jump(stages[0].plannedStart)}>Project start</button>}
        </div>
        <div className="row">
          <div className="row" role="group" aria-label="Months shown" style={{ gap: '.2rem' }}>
            {[1, 2, 3].map((n) => <button key={n} className={`btn sm ${months === n ? '' : 'ghost'}`} aria-pressed={months === n} onClick={() => setMonths(n)}>{n} month{n > 1 ? 's' : ''}</button>)}
          </div>
          <button className="btn action" onClick={() => setEventModal({})}>+ Add deadline / item</button>
        </div>
      </div>

      <Async loading={stagesQ.loading || eventsQ.loading} error={stagesQ.error || eventsQ.error} onRetry={refresh}>
        {stages.length === 0 && <div className="alert" style={{ background: 'var(--action-tint)', color: '#7a3308' }}>No construction stages are set for this project yet. Use <strong>Edit</strong> on the project to define them and the timeline will appear here.</div>}
        {stages.length > 0 && <SchedulePill schedule={stagesQ.data.schedule} />}

        {shown.map(({ y, m }) => (
          <MonthGrid key={`${y}-${m}`} year={y} month={m} stages={stages} events={events} today={today}
            onStage={setStageModal} onDay={(d) => setEventModal({ date: d })} onEvent={(e) => setEventModal({ event: e })} />
        ))}

        <div className="row small muted" style={{ gap: '1rem' }}>
          <span><span className="swatch" style={{ background: PALETTE[0].bg, boxShadow: `inset 0 0 0 1px ${PALETTE[0].fill}` }} /> Planned stage (deeper shade = done)</span>
          <span><span className="swatch" style={{ background: DONE.bg, boxShadow: `inset 0 0 0 1px ${DONE.fill}` }} /> Completed ✓</span>
          <span><span className="swatch" style={{ background: RED.bg, boxShadow: `inset 0 0 0 1px ${RED.line}` }} /> Delay beyond the original plan</span>
          <span><span className="swatch" style={{ background: HATCH, boxShadow: `inset 0 0 0 1px ${RED.line}` }} /> Overdue until today</span>
          {EVENT_TYPES.map((t) => <span key={t.value}>{t.icon} {t.label}</span>)}
        </div>
        <div className="small muted">Click a stage bar to change its deadline · Click any day to add an item.</div>

        {stages.length > 0 && (
          <section className="stack">
            <h2>Stage timeline</h2>
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Done</th><th>#</th><th>Stage</th><th>% of project</th><th>Start</th><th>Deadline</th><th>Timeline</th><th>Progress</th><th /></tr></thead>
                <tbody>
                  {stages.map((s, i) => (
                    <tr key={s.id}>
                      <td><input autoComplete="off" type="checkbox" style={{ width: 20, height: 20 }} aria-label={`Mark ${s.name} complete`} checked={s.status === 'COMPLETED'}
                        onChange={(e) => (e.target.checked ? setCompleteModal(s) : setReopen(s))} /></td>
                      <td><span className="badge" style={{ background: colorOf(i).fill, color: colorOf(i).fg }}>{i + 1}</span></td>
                      <td><strong>{s.name}</strong><div><StatusBadge status={s.status} /></div></td>
                      <td>{pct(s.weightPercent)}</td><td>{fmtShort(s.plannedStart)}</td>
                      <td>{fmtShort(s.plannedEnd)}{s.baselineEnd && s.baselineEnd !== s.plannedEnd && <div className="small muted">was {fmtShort(s.baselineEnd)}</div>}
                        {s.actualEnd && <div className="small muted">done {fmtShort(s.actualEnd)}</div>}</td>
                      <td><TimingChip timing={s.timing} /></td>
                      <td style={{ minWidth: 120 }}><ProgressBar value={s.completionPercent} name={`${s.name} progress`} /><span className="small muted">{pct(s.completionPercent)}</span></td>
                      <td><button className="btn sm ghost" onClick={() => { jump(s.plannedStart); setStageModal(s); }}>Edit dates</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="small muted">Planned completion: <strong>{fmtShort(latestEnd(stages))}</strong> · Overall progress {pct(stagesQ.data.overallProgress)}</div>
          </section>
        )}

        {stages.length > 0 && (
          <section className="stack">
            <h2>Delay impact</h2>
            <div className="card"><DelayImpact delays={delays} stages={stages} /></div>
          </section>
        )}

        {events.length > 0 && (
          <section className="stack">
            <h2>Deadlines &amp; extra items</h2>
            <div className="card">
              {events.map((e) => (
                <div key={e.id} className="row between" style={{ padding: '.4rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div><strong>{typeOf(e.eventType).icon} {e.title}</strong><div className="small muted">{fmtShort(e.startDate)}{e.endDate && ` → ${fmtShort(e.endDate)}`} · {label(e.eventType)}{e.notes && ` · ${e.notes}`}</div></div>
                  <button className="btn sm ghost" onClick={() => setEventModal({ event: e })}>Edit</button>
                </div>
              ))}
            </div>
          </section>
        )}
      </Async>

      {eventModal && <EventModal projectId={projectId} event={eventModal.event} date={eventModal.date} onClose={() => setEventModal(null)} onDone={() => { setEventModal(null); refresh(); }} />}
      {stageModal && <StageModal projectId={projectId} stages={stages} delays={delays} stage={stages.find((s) => s.id === stageModal.id) ?? stageModal} onClose={() => setStageModal(null)} onDone={() => { setStageModal(null); refresh(); }} />}
      {completeModal && <CompleteModal projectId={projectId} stage={completeModal} onClose={() => setCompleteModal(null)} onDone={() => { setCompleteModal(null); refresh(); }} />}
      {reopen && (
        <ConfirmDialog title="Re-open this stage?" confirmText="Re-open" message={`“${reopen.name}” goes back to 0% and the project’s overall progress is recalculated.`} onCancel={() => setReopen(null)}
          onConfirm={async () => { try { await api.post(`/projects/${projectId}/stages/${reopen.id}/complete`, { completed: false }); toast.success('Stage re-opened'); setReopen(null); refresh(); } catch (err) { toast.error(errorMessage(err)); setReopen(null); } }} />
      )}
    </div>
  );
}
