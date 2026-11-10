# Brightlook Homes — Construction Project Management CRM

One PostgreSQL database + one Express API + three role-based portals (Admin, Project Manager, Customer) in one React app.

## Run it

```bash
cd backend  && npm install && cp .env.example .env
npm run seed -- --demo     # admin + demo PM/customer/project (runs migrations first)
npm start                  # API on http://localhost:4000

cd ../frontend && npm install && npm run dev   # http://localhost:5173 (proxies /api to :4000)
```

Demo logins (local only): `admin / app@123` (override with `SEED_ADMIN_PASSWORD`), `mahendar / app@123` (PM), `customer1 / app@123`.

**Database:** with `DATABASE_URL` empty the API uses an embedded Postgres (PGlite, stored in `backend/data`). Set `DATABASE_URL=postgres://user:pass@host:5432/db` to use a real PostgreSQL server; migrations run automatically on start (`npm run migrate` to run them alone).

## Tests

```bash
cd backend  && npm test    # 34 integration/security tests on a real Postgres engine (in-memory)
cd frontend && npm test    # 10 component/unit tests
```

## Architecture (short)

- `backend/src/modules/<feature>/` — routes → controller → service → repository (payments, approvals, notifications, audit and files keep routes+handlers together to stay compact; their logic still lives in services).
- Authorization is enforced server-side: role middleware + `requireProjectAccess` (assignment check) on every project-scoped resource.
- Auth: bcrypt, JWT access token + rotating refresh token in HttpOnly SameSite cookies, replay detection, lockout, CSRF header guard, rate limits, Helmet.
- Audit rows are written inside the same DB transaction as the business change; a trigger makes `audit_logs` append-only.
- Files: stored via a `LocalStorageAdapter` (swap for S3/Azure), content sniffed by magic bytes, served only through `GET /api/v1/files/:id` with per-project access checks.
- Money is `NUMERIC`; customer payments are an append-only ledger (reversals/refunds are negative rows), kept separate from vendor bills.
- Project progress is an explicitly managed percentage (set by PM progress updates or Admin); payment progress = net verified receipts ÷ contract amount.

## Business-rule decisions to confirm

1. Overpayment (receipts beyond the contract amount) is rejected.
2. Admin-recorded payments are treated as verified; there is no separate reconcile step yet.
3. A bill that is clarified then resubmitted returns to `PENDING_ADMIN_REVIEW` (the `RESUBMITTED` status exists but is unused).
4. Only PMs create bills; admins review. Nobody can review their own bill.

## Not built yet (deferred)

Forgot-password email flow, notification preferences/delivery logs, weighted milestones (`project_milestones`), payment terms/allocations/receipts tables, multi-tenant `organization_id`, charts, email/WhatsApp, browser E2E tests, and a roles/user_roles table (single `users.role` today).
