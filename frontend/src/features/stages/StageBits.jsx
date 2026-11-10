import { useState } from 'react';
import { fmtDateTime } from '../../utils/format.js';
import { diffDays, fmtShort } from '../../utils/dates.js';

const TIMING = {
  ON_TRACK: { text: 'On track', tone: 'success' },
  EXTENDED: { text: 'Deadline extended', tone: 'error', days: '+' },
  OVERDUE: { text: 'Overdue by', tone: 'error', days: 'd' },
  COMPLETED_ON_TIME: { text: 'Completed on time', tone: 'success' },
  COMPLETED_EARLY: { text: 'Completed early by', tone: 'success', days: 'd' },
  COMPLETED_LATE: { text: 'Completed late by', tone: 'error', days: 'd' },
};

/** One-glance status for a stage: on time (green) or delayed (red). */
export function TimingChip({ timing }) {
  const t = TIMING[timing?.state] ?? TIMING.ON_TRACK;
  const days = timing?.days ?? 0;
  return <span className={`badge ${t.tone}`}>{t.text}{t.days === '+' ? ` +${days}d` : t.days === 'd' ? ` ${days}d` : ''}</span>;
}

/** Whole-project verdict: on schedule or delayed, with how far it slipped. */
export function SchedulePill({ schedule }) {
  if (!schedule?.plannedCompletion) return null;
  const late = schedule.state === 'DELAYED';
  return (
    <div className="alert" role="status" style={late ? undefined : { background: '#e3f4ea', color: '#14532d' }}>
      <strong>{late ? 'Behind schedule' : 'On schedule'}</strong>
      {late && schedule.slipDays > 0 && <> — completion has slipped <strong>{schedule.slipDays} day{schedule.slipDays > 1 ? 's' : ''}</strong> ({fmtShort(schedule.baselineCompletion)} → {fmtShort(schedule.plannedCompletion)})</>}
      {late && schedule.overdueStages > 0 && <> · {schedule.overdueStages} stage{schedule.overdueStages > 1 ? 's are' : ' is'} overdue</>}
      {late && schedule.completedLate > 0 && <> · {schedule.completedLate} finished late</>}
      {!late && <> — planned completion {fmtShort(schedule.plannedCompletion)}</>}
    </div>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One decision (one reason) can push several stages back: group those rows into a single event. */
function groupEvents(delays) {
  const map = new Map();
  for (const d of delays) {
    const key = `${d.createdAt}|${d.reason}|${d.createdByName ?? ''}`;
    if (!map.has(key)) map.set(key, { key, reason: d.reason, createdAt: d.createdAt, by: d.createdByName, items: [] });
    map.get(key).items.push(d);
  }
  return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * How much each stage was affected, by how many days, and why.
 * Top: headline numbers. Middle: one row per affected stage. Bottom: the history of decisions (collapsible).
 */
export function DelayImpact({ delays, stages = [], initialEvents = 3 }) {
  const [all, setAll] = useState(false);
  if (!delays?.length) return <p className="small muted" style={{ margin: 0 }}>No delays have been recorded.</p>;

  const byStage = new Map();
  for (const d of delays) {
    const k = d.stageId ?? d.stageName;
    byStage.set(k, [...(byStage.get(k) ?? []), d]);
  }
  const rows = [...byStage.entries()].map(([k, list]) => {
    const stage = stages.find((s) => s.id === k);
    const logged = list.reduce((a, d) => a + d.days, 0);
    const net = stage?.baselineEnd ? Math.max(0, diffDays(stage.baselineEnd, stage.plannedEnd)) : logged;
    return { k, stage, name: list[0].stageName, list, logged, net, order: stage ? stages.indexOf(stage) : 99 };
  }).sort((a, b) => a.order - b.order);
  const events = groupEvents(delays);
  const shown = all ? events : events.slice(0, initialEvents);
  const projectSlip = Math.max(0, ...rows.map((r) => r.net));

  return (
    <div className="stack">
      <div className="delay-stats">
        <div><strong>{plural(rows.length, 'stage')}</strong><span>affected</span></div>
        <div><strong>{plural(events.length, 'delay event')}</strong><span>recorded</span></div>
        <div className="bad"><strong>up to {plural(projectSlip, 'day')}</strong><span>worst stage delay now</span></div>
      </div>

      <div className="table-wrap">
        <table className="table delay-table" aria-label="Delay impact by stage">
          <thead><tr><th>Stage</th><th>Original end</th><th>Ends now</th><th>Delayed by</th><th>Why</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <td data-label="Stage" className="cell-title"><strong>{r.name}</strong></td>
                <td data-label="Original end">{r.stage?.baselineEnd ? fmtShort(r.stage.baselineEnd) : '—'}</td>
                <td data-label="Ends now">{r.stage ? fmtShort(r.stage.plannedEnd) : '—'}</td>
                <td data-label="Delayed by">{r.net > 0 ? <span className="badge error">+{r.net} day{r.net > 1 ? 's' : ''}</span> : <span className="badge success">Recovered</span>}</td>
                <td data-label="Why" className="cell-wide">
                  <ul className="reasons">
                    {r.list.map((d) => (
                      <li key={d.id}>
                        <span className="days">+{d.days}d</span> {d.reason}
                        {d.kind === 'SHIFTED' && d.causeStageName && <span className="muted"> — pushed back by {d.causeStageName}</span>}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details open={false}>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>History: every delay decision ({events.length})</summary>
        <div className="stack" style={{ marginTop: '.6rem' }}>
          {shown.map((e) => (
            <div key={e.key} className="delay-event">
              <div className="row between small">
                <strong>{e.reason}</strong>
                <span className="muted">{fmtDateTime(e.createdAt)}{e.by && ` · ${e.by}`}</span>
              </div>
              <div className="row small" style={{ marginTop: '.3rem' }}>
                {e.items.map((d) => (
                  <span key={d.id} className="badge error" title={`${fmtShort(d.previousEnd)} → ${fmtShort(d.newEnd)}`}>
                    {d.stageName} +{d.days}d{d.kind === 'EXTENDED' ? ' (cause)' : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {events.length > initialEvents && (
            <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${events.length} delay events`}
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

/** Compact list for a single stage (used inside the stage editor). */
export function DelayLog({ delays }) {
  if (!delays?.length) return null;
  return (
    <ul className="reasons">
      {delays.map((d) => (
        <li key={d.id}><span className="days">+{d.days}d</span> {d.reason} <span className="muted">· {fmtShort(d.previousEnd)} → {fmtShort(d.newEnd)}</span></li>
      ))}
    </ul>
  );
}
