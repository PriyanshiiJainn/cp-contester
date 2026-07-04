# CP Contester

On-demand **Codeforces virtual contests**: enter your CF handle, pick a division
(Div. 1–4) and a duration, and get a contest built only from problems you
haven't solved. Solve on real Codeforces; the app detects your ACs and, when
the round ends, shows an estimated performance and rating change.

No login, no passwords — everything uses **public** CF data by handle.
The browser never calls codeforces.com directly; all CF traffic goes through
the `/api/cf/[method]` proxy route.

## Layout

| Package | What |
|---|---|
| `apps/web` | Next.js (App Router): UI, `/api/cf` proxy, `/api/ingest` cron, contest build/finish routes |
| `packages/cf` | Typed CF client + zod schemas + `divisionOf()` |
| `packages/rating` | Pure performance → delta estimator (Vitest-tested) |
| `packages/db` | Prisma schema + client (`Problem`, `VirtualRound`) |

## Architecture (what talks to what)

```
Browser ──► Next.js API routes ──► Codeforces API (proxy / build / ingest)
                │
                └──► Prisma ──► Supabase Postgres
                     Problem cache + finished VirtualRound rows
```

You do **not** need `@supabase/supabase-js` or Supabase Auth for v1.
Supabase is used only as a hosted Postgres database. Prisma is the client.
In-flight contests live in `localStorage`; only finished rounds are written to
the DB.

## Connect Supabase (do this once)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **Project Settings → Database → Connection string**.
3. Copy two URIs into both env files below (same values in each):

   | Env var | Which string | Notes |
   |---|---|---|
   | `DATABASE_URL` | **Transaction** pooler (port **6543**) | Append `?pgbouncer=true` |
   | `DIRECT_URL` | **Session** pooler (port **5432**) | Used by `prisma migrate` only |
   | `CRON_SECRET` | any long random string | Guards `/api/ingest` |

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   cp packages/db/.env.example packages/db/.env
   # edit both files with your real URIs + CRON_SECRET
   ```

4. Install, migrate, run:

   ```bash
   pnpm install                         # also runs prisma generate
   pnpm --filter @cp/db migrate:deploy  # creates Problem + VirtualRound tables
   pnpm --filter web dev                # http://localhost:3000
   ```

5. Seed the problem cache **once** (daily cron re-runs it in prod):

   ```bash
   curl -H "x-ingest-secret: <your-CRON_SECRET>" http://localhost:3000/api/ingest
   ```

   That pulls `problemset.problems` + `contest.list` (two CF calls), stamps
   each problem's division from its contest title, and fills `Problem`
   (~11k rows). Until this has run, "Start" returns
   `503 problem cache is empty`.

## Local development

```bash
pnpm install
pnpm test                       # vitest: packages/rating + packages/cf
# (env files + migrate + ingest — see above)
pnpm --filter web dev
```

## Deploying to Vercel

1. Import the repo; set **Root Directory** to `apps/web` (Vercel detects the
   Turborepo + pnpm workspace and installs from the repo root).
2. Set `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET` env vars (same as local).
3. `apps/web/vercel.json` already schedules `/api/ingest` daily at 03:17 UTC.
4. Run the migration once from your machine
   (`pnpm --filter @cp/db migrate:deploy`) and hit `/api/ingest` once.

## How the estimate works

`packages/rating`: P(solve problem of difficulty d at rating R) is the Elo
expectancy `1 / (1 + 10^((d-R)/400))`. We binary-search the R whose expected
solve count equals your actual solve count → that's the performance;
`delta = round((perf − rating) / 2)`. It is a deliberately rough single-user
estimate — speed, hacks, and the actual field are ignored, and it is labeled
as such in the UI.

## v1 scope notes (TODOs, intentionally not built)

- **Handle-ownership verification** — anyone can start a round as any handle.
- **Penalty / speed scoring** — solve minute is recorded per problem
  (`solvedIds` + minute in the UI state) as a seam for ICPC/IOI-style scoring.
- Combined "Div. 1 + Div. 2" rounds are filed under Div. 1 (first match in the
  title); a future version could file them under both.
- The contest builder may pick two problems from the same past contest.
- `VirtualRound` rows are written only at round end; in-flight rounds live in
  `localStorage` (timer is derived from `startedAt`, so refresh can't pause it).
