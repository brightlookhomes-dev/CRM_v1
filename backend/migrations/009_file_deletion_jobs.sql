create table file_deletion_jobs (
  id bigserial primary key,
  storage_provider text not null,
  relative_path text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  unique (storage_provider, relative_path)
);
create index idx_file_deletion_jobs_due on file_deletion_jobs (next_attempt_at, id);
