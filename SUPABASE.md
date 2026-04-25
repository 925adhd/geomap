# Supabase state

Live snapshot of the Supabase project this app talks to. Update this file
any time the schema changes (new column, new index, new table, RLS tweak).
Serves as the source of truth when there's no CLI link to the project.

- Project ref: `aumuepxxwsjzticgznof`
- URL: `https://aumuepxxwsjzticgznof.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/aumuepxxwsjzticgznof
- Table editor: https://supabase.com/dashboard/project/aumuepxxwsjzticgznof/editor
- SQL editor: https://supabase.com/dashboard/project/aumuepxxwsjzticgznof/sql/new
- Logs: https://supabase.com/dashboard/project/aumuepxxwsjzticgznof/logs/postgres-logs

## Auth model

- Browser → Vercel API routes (CORS + rate limit guards in `app/api/*`)
- API routes → Supabase using `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- Browser never talks to Supabase directly
- RLS is enabled on every table with no policies — so `anon` / `sb_publishable`
  keys see nothing. Only the server-side service_role can read/write.

## Tables

### `leads`
Audit form submissions from the public site. Read by the admin dashboard,
written by `POST /api/leads`.

| column        | type         | notes                                  |
|---------------|--------------|----------------------------------------|
| timestamp     | timestamptz  | primary key (ISO from API route)       |
| business_name | text         | not null                               |
| email         | text         | not null, lowercased                   |
| phone         | text         | nullable                               |
| keyword       | text         | nullable                               |
| notes         | text         | nullable                               |
| status        | text         | default `'new'` — new/contacted/scanned/closed |
| ip            | text         | nullable, captured from x-forwarded-for |

Indexes:
- `leads_email_idx` on `(email, timestamp desc)` — 30-day email dedup
- `leads_ip_idx` on `(ip, timestamp desc)` — daily 3/IP rate limit

### `scans`
Full scan payload as JSONB. Written by `POST /api/scans` (admin-only)
and `POST /api/auto-scan` (public auto-audit), read by `GET /api/scans`
and the public report page `/report/[timestamp]`.

| column              | type           | notes                                  |
|---------------------|----------------|----------------------------------------|
| timestamp           | timestamptz    | primary key                            |
| payload             | jsonb          | not null — full Scan object            |
| essentials_calls    | integer        | not null default 0 — Places Essentials calls this scan made |
| enterprise_calls    | integer        | not null default 0 — Places Enterprise calls this scan made |
| estimated_cost_usd  | numeric(8,4)   | not null default 0 — what this scan would cost outside the free tier |

Indexes:
- `scans_timestamp_idx` on `(timestamp desc)`

Cost columns are populated at save time so each row records what the
scan actually cost. Sort by `estimated_cost_usd desc` in the Supabase
table editor to spot expensive scans; sum it for monthly totals. Rows
saved before this column was added show `0` (we didn't track them).

### `usage`
One row per UTC month. Tracks Places API call volume so `/api/places`
can enforce the monthly cost cap.

| column            | type         | notes                                  |
|-------------------|--------------|----------------------------------------|
| month             | text         | primary key, format `YYYY-MM` UTC      |
| essentials_calls  | integer      | not null default 0                     |
| enterprise_calls  | integer      | not null default 0                     |
| last_updated      | timestamptz  | not null default now()                 |

No extra indexes — primary key handles all lookups.

## Code that touches Supabase

- [lib/supabase.ts](lib/supabase.ts) — server-only client factory
- [lib/usage.ts](lib/usage.ts) — `usage` table reads/upserts
- [app/api/leads/route.ts](app/api/leads/route.ts) — `leads` CRUD (admin GET/DELETE; legacy public POST)
- [app/api/scans/route.ts](app/api/scans/route.ts) — `scans` CRUD (admin only)
- [app/api/auto-scan/route.ts](app/api/auto-scan/route.ts) — public auto-audit: writes both `leads` and `scans`
- [app/report/[timestamp]/page.tsx](app/report/[timestamp]/page.tsx) — public report read

## Cross-table invariant: shared timestamp

Leads and scans created together via `/api/auto-scan` share the **same
`timestamp`** value (used as the primary key in both tables). This is how
the lifetime per-email dedup works: look up the lead by email → take its
`timestamp` → fetch the scan with the same key → return that report URL.

If you ever insert a lead or scan manually (SQL editor, admin tooling),
keep this invariant in mind. A lead without a matching scan row will be
treated as "no existing report" and trigger a fresh scan.

## Env vars required

Both are server-only, never `NEXT_PUBLIC_`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Set in `.env.local` for dev, and in Vercel → Project Settings → Environment
Variables (Production + Preview + Development) for deploys.

## How to update this file

When the schema changes:
1. Run the migration in the Supabase SQL editor.
2. Edit this file's table section to match.
3. Bump the "Last verified" date below.

Last verified: 2026-04-25 (added per-scan cost columns to scans table)
