-- Baseline = the originally planned dates of a stage; used to tell on-time from delayed.
alter table project_stages add column baseline_start date;
alter table project_stages add column baseline_end date;
update project_stages set baseline_start = planned_start, baseline_end = planned_end;

-- Every time a deadline slips, the reason is recorded. SHIFTED rows are stages pushed back by another stage's delay.
create table project_stage_delays (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  stage_id uuid references project_stages(id) on delete set null,
  stage_name text not null,
  cause_stage_id uuid references project_stages(id) on delete set null,
  cause_stage_name text,
  kind text not null check (kind in ('EXTENDED','SHIFTED')),
  days int not null check (days > 0),
  previous_end date not null,
  new_end date not null,
  reason text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index idx_stage_delays_project on project_stage_delays (project_id, created_at desc);
