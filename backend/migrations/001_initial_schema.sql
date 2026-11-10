-- Brightlook Homes CRM: initial schema. Money = NUMERIC, ids = UUID, times = TIMESTAMPTZ.

create sequence project_code_seq start 1001;

create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  full_name text not null,
  email text,
  phone text,
  password_hash text not null,
  role text not null check (role in ('ADMIN','PROJECT_MANAGER','CUSTOMER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_users_username on users (lower(username));
create unique index uq_users_email on users (lower(email)) where email is not null;
create index idx_users_role on users (role);

create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  created_at timestamptz not null default now()
);
create index idx_refresh_user on refresh_tokens (user_id);

-- Files: metadata only; bytes live in the storage provider (local disk now, S3/Azure later).
create table files (
  id uuid primary key default gen_random_uuid(),
  original_name text not null,
  stored_name text not null,
  relative_path text not null unique,
  mime_type text not null,
  file_extension text not null,
  file_size bigint not null,
  storage_provider text not null default 'local',
  checksum text not null,
  project_id uuid,                       -- intentionally no FK: files outlive project lifecycle
  visibility text not null default 'PROJECT' check (visibility in ('PROJECT','INTERNAL')),
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index idx_files_project on files (project_id);

create table projects (
  id uuid primary key default gen_random_uuid(),
  project_code text not null unique,
  name text not null,
  description text,
  location text not null,
  project_type text not null,
  contract_amount numeric(14,2) not null default 0 check (contract_amount >= 0),
  start_date date,
  expected_completion_date date,
  actual_completion_date date,
  cover_image_file_id uuid references files(id),
  overall_progress numeric(5,2) not null default 0 check (overall_progress between 0 and 100),
  status text not null default 'PLANNED' check (status in
    ('PLANNED','NOT_STARTED','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED','ARCHIVED')),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_projects_status on projects (status) where deleted_at is null;

create table project_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  user_id uuid not null references users(id),
  assignment_role text not null check (assignment_role in ('PROJECT_MANAGER','CUSTOMER')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references users(id),
  is_active boolean not null default true,
  unassigned_at timestamptz
);
create unique index uq_active_assignment on project_assignments (project_id, user_id, assignment_role) where is_active;
create index idx_assign_user on project_assignments (user_id) where is_active;
create index idx_assign_project on project_assignments (project_id) where is_active;

create table project_progress_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  previous_progress numeric(5,2),
  new_progress numeric(5,2) not null,
  changed_by uuid references users(id),
  note text,
  created_at timestamptz not null default now()
);
create index idx_progress_project on project_progress_history (project_id, created_at desc);

create table project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  created_by uuid not null references users(id),
  update_type text not null check (update_type in ('PROGRESS','MATERIAL','GENERAL','APPROVAL_REQUEST')),
  title text,
  description text,
  progress_percentage numeric(5,2) check (progress_percentage between 0 and 100),
  work_completed text,
  work_remaining text,
  material_name text,
  quantity numeric(12,3),
  unit text,
  supplier text,
  delivery_status text check (delivery_status in ('ORDERED','IN_TRANSIT','DELIVERED','PARTIAL','REJECTED')),
  delivery_date date,
  decision_request_id uuid,
  update_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_updates_project on project_updates (project_id, update_date desc);

create table project_update_files (
  update_id uuid not null references project_updates(id) on delete cascade,
  file_id uuid not null references files(id),
  kind text not null check (kind in ('PHOTO','DOCUMENT')),
  primary key (update_id, file_id)
);

create table decision_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  title text not null,
  description text,
  category text,
  details text,
  status text not null default 'PENDING_CUSTOMER' check (status in
    ('DRAFT','PENDING_CUSTOMER','RESPONDED','APPROVED','REJECTED','CANCELLED','EXPIRED')),
  requires_admin_approval boolean not null default false,
  requested_by uuid not null references users(id),
  deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_decisions_project on decision_requests (project_id, status);

create table decision_options (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decision_requests(id) on delete cascade,
  label text not null,
  description text,
  price_note text,
  additional_charge numeric(12,2),
  sort_order int not null default 0,
  unique (id, decision_id)
);

create table decision_responses (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decision_requests(id),
  option_id uuid not null,
  responded_by uuid not null references users(id),
  comment text,
  created_at timestamptz not null default now(),
  -- guarantees the chosen option belongs to this decision
  foreign key (option_id, decision_id) references decision_options (id, decision_id)
);

create table decision_files (
  decision_id uuid not null references decision_requests(id) on delete cascade,
  response_id uuid references decision_responses(id),
  file_id uuid not null references files(id),
  primary key (decision_id, file_id)
);

create table decision_history (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decision_requests(id),
  from_status text,
  to_status text not null,
  actor_id uuid references users(id),
  comment text,
  created_at timestamptz not null default now()
);
create index idx_decision_hist on decision_history (decision_id, created_at);

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  requester_id uuid not null references users(id),
  approval_type text not null check (approval_type in
    ('BILL_REVIEW','DECISION_ESCALATION','ADDITIONAL_CHARGE','PROJECT','OTHER')),
  entity_type text not null,   -- polymorphic: validated in service layer
  entity_id uuid not null,
  title text not null,
  summary text,
  status text not null default 'PENDING' check (status in
    ('PENDING','APPROVED','REJECTED','CLARIFICATION_REQUIRED','CANCELLED')),
  current_assignee_id uuid references users(id),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index idx_approvals_status on approval_requests (status, requested_at desc);
create index idx_approvals_entity on approval_requests (entity_type, entity_id);

create table approval_actions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references approval_requests(id),
  actor_id uuid references users(id),
  action text not null,
  comment text,
  previous_status text,
  new_status text,
  created_at timestamptz not null default now()
);
create index idx_approval_actions on approval_actions (approval_id, created_at);

create table vendor_bills (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  submitted_by uuid not null references users(id),
  vendor_name text not null,
  invoice_number text not null,
  amount numeric(14,2) not null check (amount > 0),
  tax_amount numeric(14,2) check (tax_amount >= 0),
  bill_date date not null,
  due_date date,
  description text,
  status text not null default 'PENDING_ADMIN_REVIEW' check (status in
    ('DRAFT','PENDING_ADMIN_REVIEW','CLARIFICATION_REQUIRED','RESUBMITTED','APPROVED','REJECTED','PAID','CANCELLED')),
  current_version int not null default 1,
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_vendor_bill_invoice on vendor_bills (project_id, lower(vendor_name), lower(invoice_number));
create index idx_bills_project on vendor_bills (project_id, status);
create index idx_bills_status on vendor_bills (status, created_at desc);

create table vendor_bill_versions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references vendor_bills(id),
  version_no int not null,
  file_id uuid not null references files(id),
  amount numeric(14,2) not null,
  note text,
  submitted_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (bill_id, version_no)
);

create table vendor_bill_attachments (
  bill_id uuid not null references vendor_bills(id),
  version_no int not null,
  file_id uuid not null references files(id),
  primary key (bill_id, file_id)
);

create table vendor_bill_reviews (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references vendor_bills(id),
  version_no int not null,
  actor_id uuid references users(id),
  action text not null,
  comment text,
  previous_status text,
  new_status text,
  created_at timestamptz not null default now()
);
create index idx_bill_reviews on vendor_bill_reviews (bill_id, created_at);

-- Customer receivables ledger. Append-only: corrections are REVERSAL/REFUND rows (negative amounts).
create table customer_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  entry_type text not null default 'PAYMENT' check (entry_type in ('PAYMENT','REFUND','REVERSAL')),
  payment_type text check (payment_type in ('ADVANCE','MILESTONE','INSTALLMENT','PARTIAL','FINAL')),
  amount numeric(14,2) not null check (amount <> 0),
  payment_method text not null check (payment_method in ('BANK_TRANSFER','UPI','CHEQUE','CASH','CARD','OTHER')),
  payment_date date not null,
  reference_number text not null,
  receipt_file_id uuid references files(id),
  reverses_payment_id uuid references customer_payments(id),
  notes text,
  recorded_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check ((entry_type = 'PAYMENT' and amount > 0) or (entry_type <> 'PAYMENT' and amount < 0))
);
create unique index uq_payment_reference on customer_payments (project_id, lower(reference_number)) where entry_type = 'PAYMENT';
create unique index uq_payment_reversal on customer_payments (reverses_payment_id) where reverses_payment_id is not null;
create index idx_payments_project on customer_payments (project_id, payment_date desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references users(id),
  project_id uuid references projects(id),
  notification_type text not null,
  title text not null,
  message text,
  entity_type text,
  entity_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notif_recipient on notifications (recipient_id, is_read, created_at desc);

-- Audit log: no FKs so records survive archival; append-only enforced by trigger.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_role text,
  action_type text not null,
  module text not null,
  entity_type text,
  entity_id uuid,
  project_id uuid,
  previous_data jsonb,
  new_data jsonb,
  description text,
  ip_address text,
  user_agent text,
  request_id text,
  created_at timestamptz not null default now()
);
create index idx_audit_created on audit_logs (created_at desc);
create index idx_audit_actor on audit_logs (actor_user_id);
create index idx_audit_project on audit_logs (project_id);
create index idx_audit_action on audit_logs (action_type);
create index idx_audit_entity on audit_logs (entity_type, entity_id);

create function audit_logs_immutable() returns trigger as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$ language plpgsql;
create trigger trg_audit_no_update before update or delete on audit_logs
  for each row execute function audit_logs_immutable();
