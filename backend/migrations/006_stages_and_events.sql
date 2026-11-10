-- Pre-decided construction plan: weighted stages with durations, scheduled sequentially from the project start.
create table project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text not null,
  weight_percent numeric(5,2) not null check (weight_percent > 0 and weight_percent <= 100),
  duration_days int not null check (duration_days > 0),
  sort_order int not null,
  planned_start date,
  planned_end date,
  completion_percent numeric(5,2) not null default 0 check (completion_percent between 0 and 100),
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED','IN_PROGRESS','COMPLETED')),
  actual_start date,
  actual_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_stages_project on project_stages (project_id, sort_order);

-- Extra calendar items (deadlines, meetings, deliveries...) shown alongside the stage timeline.
create table project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  title text not null,
  event_type text not null default 'DEADLINE' check (event_type in ('DEADLINE','MEETING','DELIVERY','INSPECTION','OTHER')),
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_events_project on project_events (project_id, start_date);

-- Progress updates can target a stage; overall_after records the project progress that resulted.
alter table project_updates add column stage_id uuid references project_stages(id) on delete set null;
alter table project_updates add column overall_after numeric(5,2);
