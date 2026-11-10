// Date helpers on plain "YYYY-MM-DD" strings (UTC math, so no timezone drift).
const D = (s) => new Date(`${s}T00:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((D(b) - D(a)) / 86_400_000);
export const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/**
 * Stage i starts (previous stage end + 1 day) + startOffsetDays: 0 = right after, negative = overlaps the previous
 * stage, positive = a gap. The first stage starts on `startDate`. Durations are inclusive days. Mirrors the server.
 */
export function scheduleStages(startDate, items) {
  let cursor = startDate;
  return items.map((it, i) => {
    const offset = i === 0 ? 0 : Number(it.startOffsetDays) || 0;
    const plannedStart = addDays(cursor, offset);
    const plannedEnd = addDays(plannedStart, Math.max(1, Number(it.durationDays) || 1) - 1);
    cursor = addDays(plannedEnd, 1);
    return { ...it, plannedStart, plannedEnd };
  });
}

/** Latest end date across stages (stages may overlap, so it is not necessarily the last stage's end). */
export const latestEnd = (stages) => stages.reduce((m, s) => (s.plannedEnd > m ? s.plannedEnd : m), stages[0]?.plannedEnd ?? '');

/** Weeks (Sunday-first) covering a month, each an array of 7 ISO dates. */
export function monthWeeks(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  let cursor = addDays(iso(first), -first.getUTCDay());
  const lastOfMonth = iso(new Date(Date.UTC(year, month + 1, 0)));
  const weeks = [];
  while (cursor <= lastOfMonth) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export const monthTitle = (year, month) => new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const fmtShort = (s) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
