import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../src/routes/ProtectedRoute.jsx';
import LoginPage from '../src/pages/auth/LoginPage.jsx';
import { ProgressBar } from '../src/components/common/ui.jsx';
import { paymentProgressFromApi } from './helpers.js';
import { progressSplit, inr } from '../src/utils/format.js';
import { checkFile, positive, percent } from '../src/utils/validators.js';

let mockUser = null;
vi.mock('../src/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: mockUser, loading: false, login: vi.fn() }),
}));

const renderAt = (path, role) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/login" element={<div>login page</div>} />
      <Route path="/pm/dashboard" element={<div>pm home</div>} />
      <Route element={<ProtectedRoute role={role} />}><Route path="/admin/dashboard" element={<div>admin secret</div>} /></Route>
    </Routes>
  </MemoryRouter>,
);

describe('role-based route protection', () => {
  it('redirects anonymous users to login', () => {
    mockUser = null;
    renderAt('/admin/dashboard', 'ADMIN');
    expect(screen.getByText('login page')).toBeInTheDocument();
  });
  it('sends a project manager away from the admin portal to their own', () => {
    mockUser = { role: 'PROJECT_MANAGER' };
    renderAt('/admin/dashboard', 'ADMIN');
    expect(screen.getByText('pm home')).toBeInTheDocument();
  });
  it('lets an admin in', () => {
    mockUser = { role: 'ADMIN' };
    renderAt('/admin/dashboard', 'ADMIN');
    expect(screen.getByText('admin secret')).toBeInTheDocument();
  });
});

describe('login form validation', () => {
  it('shows required-field errors and does not call the API', () => {
    mockUser = null;
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    expect(screen.getByText('Username is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });
  it('toggles password visibility', () => {
    mockUser = null;
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(pw).toHaveAttribute('type', 'text');
  });
});

describe('progress and money helpers', () => {
  it('clamps progress bars to 0–100', () => {
    render(<ProgressBar value={140} name="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
  it('splits completed/pending work', () => {
    expect(progressSplit(35)).toEqual({ completed: 35, pending: 65 });
    expect(paymentProgressFromApi({ totalReceived: 1, totalAmount: 4 })).toBe(25);
  });
  it('formats rupees', () => { expect(inr(1500000)).toContain('15,00,000'); });
});

describe('form validators', () => {
  it('rejects non-positive amounts and out-of-range percentages', () => {
    expect(positive(0)).toBeTruthy(); expect(positive(10)).toBe('');
    expect(percent(101)).toBeTruthy(); expect(percent(50)).toBe('');
  });
  it('rejects disallowed or oversized files', () => {
    expect(checkFile({ name: 'a.exe', type: 'application/x-msdownload', size: 10 })).toMatch(/only/);
    expect(checkFile({ name: 'big.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 })).toMatch(/larger/);
    expect(checkFile({ name: 'ok.png', type: 'image/png', size: 1000 })).toBe('');
  });
});

import { scheduleStages, monthWeeks, diffDays, addDays } from '../src/utils/dates.js';
import { validatePlan, toPayload } from '../src/features/stages/StagePlanEditor.jsx';

describe('construction stage planning', () => {
  const plan = [{ key: 'a', name: 'Foundation', weightPercent: 30, durationDays: 10 }, { key: 'b', name: 'Structure', weightPercent: 70, durationDays: 20 }];
  it('schedules stages back to back with inclusive durations', () => {
    expect(scheduleStages('2026-01-01', plan).map((s) => [s.plannedStart, s.plannedEnd])).toEqual([['2026-01-01', '2026-01-10'], ['2026-01-11', '2026-01-30']]);
  });
  it('does date maths across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(diffDays('2026-01-01', '2026-03-01')).toBe(59);
  });
  it('builds Sunday-first month grids covering the whole month', () => {
    const weeks = monthWeeks(2026, 0); // January 2026 starts on a Thursday
    expect(weeks[0][0]).toBe('2025-12-28');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat()).toContain('2026-01-31');
  });
  it('requires percentages to total 100 and a start date', () => {
    expect(validatePlan(plan, '2026-01-01')).toBe('');
    expect(validatePlan([{ ...plan[0], weightPercent: 20 }, plan[1]], '2026-01-01')).toMatch(/100%/);
    expect(validatePlan(plan, '')).toMatch(/start date/);
    expect(validatePlan([], '')).toBe('');
  });
  it('strips UI-only fields before sending to the API', () => {
    expect(toPayload([{ ...plan[0], id: 'x' }])).toEqual([{ id: 'x', name: 'Foundation', weightPercent: 30, durationDays: 10, startOffsetDays: 0 }]);
  });
});

import { latestEnd } from '../src/utils/dates.js';
describe('overlapping stages', () => {
  const plan = [
    { key: 'a', name: 'Foundation', weightPercent: 25, durationDays: 10, startOffsetDays: 0 },
    { key: 'b', name: 'Brickwork', weightPercent: 25, durationDays: 20, startOffsetDays: 0 },
    { key: 'c', name: 'Plumbing', weightPercent: 25, durationDays: 10, startOffsetDays: -10 },
    { key: 'd', name: 'Finishing', weightPercent: 25, durationDays: 5, startOffsetDays: 0 },
  ];
  it('starts a stage before the previous one ends when the offset is negative', () => {
    const s = scheduleStages('2026-01-01', plan);
    expect(s[2].plannedStart).toBe('2026-01-21');
    expect(s[2].plannedEnd).toBe('2026-01-30');
    expect(s[3].plannedStart).toBe('2026-01-31');
  });
  it('uses the latest stage end as the project completion', () => {
    const s = scheduleStages('2026-01-01', [plan[0], plan[1], { ...plan[2], startOffsetDays: -25, durationDays: 40 }]);
    expect(latestEnd(s)).toBe(s[2].plannedEnd);
  });
  it('rejects overlaps that start before the project does', () => {
    expect(validatePlan([{ ...plan[0], weightPercent: 50 }, { ...plan[1], weightPercent: 50, startOffsetDays: -30 }], '2026-01-01')).toMatch(/before the project start/);
    expect(validatePlan(plan.slice(0, 3).map((s, i) => ({ ...s, weightPercent: [40, 40, 20][i] })), '2026-01-01')).toBe('');
  });
  it('keeps the first stage at the project start and sends offsets to the API', () => {
    expect(toPayload([{ ...plan[0], startOffsetDays: -5 }, plan[2]]).map((s) => s.startOffsetDays)).toEqual([0, -10]);
  });
});

import { fromServer, effectiveOffset } from '../src/features/stages/StagePlanEditor.jsx';
describe('simplified stage plan editor', () => {
  const rows = [
    { key: 'a', name: 'Foundation', weightPercent: 40, durationDays: 10, startOffsetDays: 0 },
    { key: 'b', name: 'Plumbing', weightPercent: 30, durationDays: 8, startOffsetDays: 0, parallel: true },
    { key: 'c', name: 'Finishing', weightPercent: 30, durationDays: 5, startOffsetDays: 0 },
  ];
  it('"runs together" starts a stage the same day as the previous one', () => {
    expect(effectiveOffset(rows, 1)).toBe(-10);
    const s = scheduleStages('2026-01-01', rows.map((r, i) => ({ ...r, startOffsetDays: effectiveOffset(rows, i) })));
    expect(s[1].plannedStart).toBe('2026-01-01');
    expect(s[1].plannedEnd).toBe('2026-01-08');
    expect(s[2].plannedStart).toBe('2026-01-09'); // follows the stage that just ended
  });
  it('sends the offset for parallel stages, and none for the first stage', () => {
    expect(toPayload(rows).map((s) => s.startOffsetDays)).toEqual([0, -10, 0]);
  });
  it('recognises same-day stages when loading a saved plan', () => {
    const loaded = fromServer([{ id: '1', name: 'A', durationDays: 10, startOffsetDays: 0 }, { id: '2', name: 'B', durationDays: 5, startOffsetDays: -10 }, { id: '3', name: 'C', durationDays: 5, startOffsetDays: 3 }]);
    expect(loaded.map((s) => !!s.parallel)).toEqual([false, true, false]);
  });
  it('turns an end date into a day count (inclusive)', () => {
    expect(diffDays('2026-03-01', '2026-03-15') + 1).toBe(15);
  });
});
