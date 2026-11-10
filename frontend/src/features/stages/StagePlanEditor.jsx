import { diffDays, fmtShort, latestEnd, scheduleStages } from '../../utils/dates.js';

let counter = 0;
export const withKeys = (items) => items.map((s) => ({ key: s.id ?? `new-${(counter += 1)}`, ...s }));
export const blankStage = () => ({ key: `new-${(counter += 1)}`, name: '', weightPercent: '', durationDays: '', startOffsetDays: 0, parallel: false });

/** Rows loaded from the server: a stage that starts the same day as the one before it is shown as "together". */
export const fromServer = (stages) => withKeys(stages.map((s, i) => ({
  ...s, parallel: i > 0 && Number(s.startOffsetDays) === -Number(stages[i - 1].durationDays),
})));

/** Days between this stage and the end of the previous one: "together" = start the same day as the previous stage. */
export const effectiveOffset = (plan, i) => {
  if (i === 0) return 0;
  return plan[i].parallel ? -(Number(plan[i - 1].durationDays) || 0) : Number(plan[i].startOffsetDays) || 0;
};
export const planForSchedule = (plan) => plan.map((s, i) => ({ ...s, startOffsetDays: effectiveOffset(plan, i) }));

/** Strip UI-only fields before sending to the API. */
export const toPayload = (plan) => planForSchedule(plan).map((s) => ({
  ...(s.id ? { id: s.id } : {}), name: s.name.trim(), weightPercent: Number(s.weightPercent), durationDays: Number(s.durationDays), startOffsetDays: s.startOffsetDays,
}));

export function validatePlan(plan, startDate) {
  if (!plan.length) return '';
  if (!startDate) return 'Pick the project start date to schedule the stages';
  if (plan.some((s) => s.name.trim().length < 2)) return 'Every stage needs a name';
  if (plan.some((s) => !(Number(s.weightPercent) > 0))) return 'Every stage needs a percentage above 0';
  if (plan.some((s) => !(Number(s.durationDays) >= 1))) return 'Every stage needs a duration of at least 1 day';
  const total = plan.reduce((a, s) => a + Number(s.weightPercent), 0);
  if (Math.abs(total - 100) > 0.01) return `Stage percentages must add up to 100% (now ${Math.round(total * 100) / 100}%)`;
  const early = scheduleStages(startDate, planForSchedule(plan)).find((s) => s.plannedStart < startDate);
  return early ? `"${early.name}" would start before the project start date` : '';
}

/**
 * Plan the construction stages: pick the start date, then add stages with their share of the project (%) and either
 * their days or their end date. Start/end dates fill in automatically, one stage after another.
 */
export default function StagePlanEditor({ plan, onChange, startDate, onStartDateChange, error }) {
  const set = (key, patch) => onChange(plan.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (i, d) => {
    const next = [...plan]; const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const dates = startDate && plan.length ? scheduleStages(startDate, planForSchedule(plan)) : [];
  const total = Math.round(plan.reduce((a, s) => a + (Number(s.weightPercent) || 0), 0) * 100) / 100;
  const ok = Math.abs(total - 100) <= 0.01;
  const setEnd = (s, i, end) => {
    if (!dates[i] || !end) return;
    set(s.key, { durationDays: Math.max(1, diffDays(dates[i].plannedStart, end) + 1) });
  };

  return (
    <fieldset className="card flat" style={{ margin: '0 0 1rem', padding: '1rem' }}>
      <legend className="small" style={{ fontWeight: 700, padding: '0 .4rem' }}>Construction stages &amp; timeline</legend>

      <div className="form-grid" style={{ alignItems: 'end' }}>
        <div className="field">
          <label htmlFor="plan-start">1. Project start date</label>
          <input autoComplete="off" id="plan-start" type="date" value={startDate ?? ''} onChange={(e) => onStartDateChange(e.target.value)} />
        </div>
        <p className="small muted" style={{ margin: '0 0 .8rem' }}>
          {startDate ? 'Dates below fill in automatically from this date.' : 'Pick the start date and each stage’s dates are worked out for you.'}
        </p>
      </div>

      <label style={{ marginBottom: '.4rem' }}>2. Stages</label>
      {plan.length === 0 && <p className="small muted" style={{ marginTop: 0 }}>No stages yet. Add the stages of this project, e.g. Foundation, Structure, Finishing.</p>}
      {plan.length > 0 && (
        <div className="table-wrap">
          <table className="table" aria-label="Construction stages">
            <thead><tr><th style={{ width: 24 }}>#</th><th>Stage</th><th style={{ width: 92 }}>% of project</th><th style={{ width: 84 }}>Days</th><th style={{ width: 110 }}>Starts</th><th style={{ width: 160 }}>Ends on</th><th /></tr></thead>
            <tbody>
              {plan.map((s, i) => (
                <tr key={s.key}>
                  <td>{i + 1}</td>
                  <td>
                    <input autoComplete="off" aria-label={`Stage ${i + 1} name`} value={s.name} onChange={(e) => set(s.key, { name: e.target.value })} placeholder="e.g. Foundation" />
                    {i > 0 && (
                      <label className="row small" style={{ fontWeight: 400, margin: '.3rem 0 0', gap: '.4rem' }}>
                        <input autoComplete="off" type="checkbox" style={{ width: 'auto' }} checked={!!s.parallel} onChange={(e) => set(s.key, { parallel: e.target.checked, startOffsetDays: 0 })} />
                        Runs together with the previous stage
                      </label>
                    )}
                  </td>
                  <td><input autoComplete="off" aria-label={`Stage ${i + 1} percentage`} type="number" min="0" max="100" step="0.5" value={s.weightPercent} onChange={(e) => set(s.key, { weightPercent: e.target.value })} /></td>
                  <td><input autoComplete="off" aria-label={`Stage ${i + 1} days`} type="number" min="1" step="1" value={s.durationDays} onChange={(e) => set(s.key, { durationDays: e.target.value })} /></td>
                  <td className="small">{dates[i] ? fmtShort(dates[i].plannedStart) : <span className="muted">—</span>}</td>
                  <td>
                    <input autoComplete="off" aria-label={`Stage ${i + 1} end date`} type="date" disabled={!dates[i]} value={dates[i]?.plannedEnd ?? ''} min={dates[i]?.plannedStart}
                      onChange={(e) => setEnd(s, i, e.target.value)} title="Change the end date and the days update automatically" />
                  </td>
                  <td><div className="row" style={{ flexWrap: 'nowrap', gap: '.2rem' }}>
                    <button type="button" className="btn sm ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="btn sm ghost" aria-label="Move down" disabled={i === plan.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="btn sm ghost" aria-label={`Remove stage ${i + 1}`} onClick={() => onChange(plan.filter((x) => x.key !== s.key))}>✕</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td /><td><strong>Total</strong></td>
                <td><strong style={{ color: ok ? 'var(--success)' : 'var(--error)' }}>{total}%</strong></td><td /><td />
                <td className="small">{dates.length ? <>Project ends <strong>{fmtShort(latestEnd(dates))}</strong></> : ''}</td><td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {!ok && plan.length > 0 && <div className="error-text" role="alert">Percentages must add up to 100% (now {total}%).</div>}
      {error && <div className="error-text" role="alert">{error}</div>}
      <div className="row" style={{ marginTop: '.6rem' }}>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...plan, blankStage()])}>+ Add stage</button>
      </div>
    </fieldset>
  );
}
