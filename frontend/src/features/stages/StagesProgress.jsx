import api, { unwrap } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { pct } from '../../utils/format.js';
import { fmtShort } from '../../utils/dates.js';
import { ProgressBar, StatusBadge } from '../../components/common/ui.jsx';
import { DelayImpact, SchedulePill, TimingChip } from './StageBits.jsx';

/** Read-only construction stage progress and timeline status, shown to every role on the project overview. */
export default function StagesProgress({ projectId, refreshKey }) {
  const { data } = useFetch(() => unwrap(api.get(`/projects/${projectId}/stages`)), [projectId, refreshKey]);
  const stages = data?.stages ?? [];
  if (!stages.length) return null;
  return (
    <section className="card stack" aria-label="Construction stages">
      <h2 style={{ margin: 0 }}>Construction stages</h2>
      <SchedulePill schedule={data.schedule} />
      {stages.map((s, i) => (
        <div key={s.id}>
          <div className="row between small">
            <span><strong>{i + 1}. {s.name}</strong> <span className="muted">· {pct(s.weightPercent)} of project</span></span>
            <span className="row" style={{ gap: '.5rem' }}><StatusBadge status={s.status} /><TimingChip timing={s.timing} /><span className="muted">{fmtShort(s.plannedStart)} → {fmtShort(s.plannedEnd)}</span></span>
          </div>
          <ProgressBar value={s.completionPercent} name={`${s.name} progress`} />
        </div>
      ))}
      {data.delays.length > 0 && (<><h3 style={{ margin: '.4rem 0 0' }}>Delay impact</h3><DelayImpact delays={data.delays} stages={stages} /></>)}
    </section>
  );
}
